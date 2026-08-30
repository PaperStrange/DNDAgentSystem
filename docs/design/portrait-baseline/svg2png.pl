#!/usr/bin/perl
use strict;
use warnings;
use Compress::Zlib;

# SVG(12x-scaled 32x40 grid) -> PNG converter for portrait baseline review.
my ($in, $out, $w, $h) = @ARGV;
$w ||= 384; $h ||= 480;

sub expand3 {
    my $c = shift;
    return $c unless $c =~ /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
    return "#$1$1$2$2$3$3";
}

open my $fh, '<', $in or die "open $in: $!";
local $/; my $svg = <$fh>; close $fh;

my $bg = '#1c1824';
if ($svg =~ /<rect width="100%" height="100%" fill="(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))"/) { $bg = $1; }
$bg = expand3($bg);
my ($br,$bgc,$bb) = map { hex } $bg =~ /^#(..)(..)(..)$/;
# 降采样倍率：按 SVG 源宽度 / 目标宽度计算（12x 源 -> 1x 目标时 scale=12），
# 修复旧版 1x 档把网格坐标当像素坐标、全部越界丢弃导致空白图的缺陷
my $sw = ($svg =~ /<svg[^>]*width="(\d+)"/) ? $1 : 384;
my $scale = $sw / $w;
$scale = 1 if $scale < 1;
my @grid; push @grid, [$br,$bgc,$bb] for 1..($w*$h);
while ($svg =~ /<rect\b([^>]*)>/g) {
    my $a = $1;
    my ($fill) = $a =~ /fill="([^"]+)"/;
    next unless $fill && $fill =~ /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
    $fill = expand3($fill);
    my ($r,$g,$b) = (hex(substr($fill,1,2)), hex(substr($fill,3,2)), hex(substr($fill,5,2)));
    if ($a =~ /width="100%"/) { next; }
    my ($x) = $a =~ /x="(\d+)"/; $x //= 0;
    my ($y) = $a =~ /y="(\d+)"/; $y //= 0;
    my ($rw) = $a =~ /width="(\d+)"/; next unless defined $rw;
    my ($rh) = $a =~ /height="(\d+)"/; next unless defined $rh;
    my $x0 = int($x / $scale); my $y0 = int($y / $scale);
    my $x1 = int(($x + $rw - 1) / $scale); my $y1 = int(($y + $rh - 1) / $scale);
    for my $yy ($y0..$y1) {
        next if $yy >= $h;
        for my $xx ($x0..$x1) {
            next if $xx >= $w;
            $grid[$yy*$w+$xx] = [$r,$g,$b];
        }
    }
}
my %seen; $seen{"@{$_}"} = 1 for @grid;
my $uniq = scalar keys %seen;

my $raw = '';
for my $y (0..$h-1) {
    $raw .= "\0";
    for my $x (0..$w-1) {
        my $p = $grid[$y*$w+$x];
        $raw .= chr($p->[0]).chr($p->[1]).chr($p->[2]);
    }
}
my $z = compress($raw);

my @crc_table;
for my $n (0..255) {
    my $c = $n;
    for (1..8) { $c = ($c & 1) ? (0xEDB88320 ^ (($c >> 1) & 0x7FFFFFFF)) : ($c >> 1); }
    $crc_table[$n] = $c;
}
sub png_crc32 {
    my $c = 0xFFFFFFFF;
    $c = $crc_table[($c ^ $_) & 0xFF] ^ (($c >> 8) & 0x00FFFFFF) for unpack('C*', $_[0]);
    return $c ^ 0xFFFFFFFF;
}
sub chunk {
    my ($type, $data) = @_;
    return pack('N', length $data) . $type . $data . pack('N', png_crc32($type.$data));
}

open my $out_fh, '>', $out or die "open $out: $!";
binmode $out_fh;
print $out_fh "\x89PNG\r\n\x1a\n";
print $out_fh chunk('IHDR', pack('NNCCCCC', $w, $h, 8, 2, 0, 0, 0));
print $out_fh chunk('IDAT', $z);
print $out_fh chunk('IEND', '');
close $out_fh;
print "wrote $out ($w x $h, uniq=$uniq)\n";
if ($uniq <= 3) {
    print STDERR "ERROR: $out 疑似空白图（唯一色数 $uniq <= 3），1x 门禁不通过\n";
    exit 1;
}
