#!/usr/bin/env perl
# S3-1 人类男性基准像 v1.1 生成器（脸型修正版）
# 相对 v1.0 的修正：
#   1. 脸颊宽度 12px(x9-22) -> 16px(x8-23)，面宽高比 0.60 -> 0.76，消除长脸观感
#   2. 发际线 y8 -> y7，额部收窄 1 行，纵向比例更均衡
#   3. 下颌圆润收窄（4 级渐收），告别直筒脸
#   4. 五官精细化：眉弓阴影 / 上眼睑线 / 眼下阴影 / 鼻根-鼻梁-鼻翼-鼻底四段 / 上下唇双色+唇峰
#   5. 光影加密：额高光加宽、右脸阴影带加宽、颧阴影、下唇下阴影
#   6. [复审修正] 躯干消灭大面积纯色：肩高光/领口阴影/左右肩光影带/三条衣褶线/下摆阴影 + 斜纹 dithering，
#      新增衣褶暗蓝 token B(#2a4a6c)；头发补充发丝高光与右侧发层暗部
# 画布 32x40, SCALE=12, 输出 384x480 SVG
use strict;
use warnings;
use File::Basename;
use File::Path qw(make_path);

my $DIR = dirname($0);
my $OUT = "$DIR/output";
make_path($OUT);

my $W = 32; my $H = 40; my $S = 12;
my $BG = '#1c1824';

my %PAL = (
  o=>'#2a1a1a', s=>'#e8b183', S=>'#c17d55', D=>'#a5643f', T=>'#f7d3a8',
  h=>'#5b3a24', H=>'#8a5a33', d=>'#4a2f1d',
  e=>'#f5efe6', i=>'#4a6b8a', p=>'#241812', k=>'#ffffff',
  n=>'#b06a45', m=>'#b35a50', M=>'#8a3f38', L=>'#c96a5e',
  E=>'#d9a077', t=>'#b97a50', u=>'#3a5a8c', U=>'#5a7aac', B=>'#2a4a6c',
);

sub make_grid { [ map { [ ('.') x $W ] } 1..$H ] }
sub set_px { my ($g,$x,$y,$c)=@_; return if $x<0||$x>=$W||$y<0||$y>=$H; $g->[$y][$x]=$c; }
sub span_fill { my ($g,$x0,$x1,$y,$c)=@_; for my $x ($x0..$x1) { set_px($g,$x,$y,$c); } }

sub auto_outline {
  my ($g) = @_;
  my @marks;
  for my $y (0..$H-1) {
    for my $x (0..$W-1) {
      next if $g->[$y][$x] ne '.';
      my $adj = 0;
      $adj++ if $x > 0 && $g->[$y][$x-1] ne '.';
      $adj++ if $x < $W-1 && $g->[$y][$x+1] ne '.';
      $adj++ if $y > 0 && $g->[$y-1][$x] ne '.';
      $adj++ if $y < $H-1 && $g->[$y+1][$x] ne '.';
      push @marks, [$x, $y] if $adj > 0;
    }
  }
  for my $m (@marks) { $g->[$m->[1]][$m->[0]] = 'o'; }
  return $g;
}

sub grid_to_svg {
  my ($g, $pal) = @_;
  my @rects; my $count = 0;
  for my $y (0..$H-1) {
    for my $x (0..$W-1) {
      my $c = $g->[$y][$x];
      next if $c eq '.';
      my $fill = $pal->{$c} or die "未知字符 '$c' @ ($x,$y)";
      push @rects, sprintf('<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>',
        $x*$S, $y*$S, $S, $S, $fill);
      $count++;
    }
  }
  my $vw = $W*$S; my $vh = $H*$S;
  my $svg = qq{<svg xmlns="http://www.w3.org/2000/svg" width="$vw" height="$vh" viewBox="0 0 $vw $vh" shape-rendering="crispEdges">\n};
  $svg .= qq{<rect width="100%" height="100%" fill="$BG"/>\n};
  $svg .= join("\n", @rects) . "\n</svg>\n";
  return ($svg, $count);
}

# ================= 人类男性 v1.1 =================
sub draw_human_male_v11 {
  my $g = make_grid();

  # ---- 头发（发顶 y1，主体 y2-7，发际线 y7）----
  span_fill($g,12,19,1,'h');
  span_fill($g,10,21,2,'h');
  for my $y (3..7) { span_fill($g,8,23,$y,'h'); }
  # 发丝高光（左上光源）
  set_px($g,10,3,'H'); set_px($g,11,3,'H'); set_px($g,11,2,'H'); set_px($g,12,2,'H');
  set_px($g,9,4,'H'); set_px($g,14,4,'H'); set_px($g,16,5,'H');
  # 发层暗部（右侧受光少）
  set_px($g,19,4,'d'); set_px($g,20,5,'d'); set_px($g,18,6,'d');
  # 鬓角
  for my $y (8..12) { span_fill($g,8,9,$y,'h'); span_fill($g,22,23,$y,'h'); }

  # ---- 脸（脸颊宽 16px：x8-23，圆润下颌 4 级渐收）----
  for my $y (8..23) { span_fill($g,8,23,$y,'s'); }
  span_fill($g,9,22,24,'s');
  span_fill($g,10,21,25,'s');
  span_fill($g,12,19,26,'s');
  span_fill($g,13,18,27,'s');

  # ---- 耳（贴脸外侧，y13-16）----
  for my $y (13..16) {
    span_fill($g,6,7,$y,'E');
    span_fill($g,24,25,$y,'E');
  }
  set_px($g,7,14,'t'); set_px($g,24,14,'t');

  # ---- 颈（x12-19，含颌下阴影）----
  span_fill($g,12,19,28,'S');
  span_fill($g,12,19,29,'s');
  span_fill($g,12,19,30,'s');

  # ---- 躯干（衣褶/光影结构，消灭大面积纯色）----
  span_fill($g,8,23,30,'u');
  for my $y (31..39) { span_fill($g,5,26,$y,'u'); }
  # 肩部高光（左上光源）
  span_fill($g,9,12,30,'U'); span_fill($g,19,22,30,'U');
  # 领口：颈下阴影 + 领口亮带 + 领角
  span_fill($g,12,19,31,'B');
  span_fill($g,13,18,32,'U'); set_px($g,12,32,'B'); set_px($g,19,32,'B');
  # 左肩亮带 / 右肩阴影带（光源左上）
  span_fill($g,5,6,31,'U'); set_px($g,5,32,'U');
  span_fill($g,25,26,31,'B'); set_px($g,26,32,'B'); set_px($g,26,33,'B');
  # 衣褶：左斜褶 / 右纵褶 / 中腹褶（暗线 + 受光侧高光线）
  set_px($g,10,33,'B'); set_px($g,9,34,'B'); set_px($g,9,35,'B'); set_px($g,8,36,'B');
  set_px($g,11,34,'U'); set_px($g,10,35,'U');
  set_px($g,21,33,'B'); set_px($g,22,34,'B'); set_px($g,22,35,'B'); set_px($g,23,36,'B');
  set_px($g,20,34,'U'); set_px($g,21,35,'U');
  set_px($g,15,35,'B'); set_px($g,16,36,'B'); set_px($g,16,37,'B');
  # 下摆阴影
  span_fill($g,7,9,38,'B'); span_fill($g,22,24,38,'B'); set_px($g,15,39,'B'); set_px($g,16,39,'B');
  # 织物 dithering：斜纹过渡消灭残余 2x2 纯色（受光半区 U / 背光半区 B）
  for my $y (30..39) {
    for my $x (5..26) {
      next unless $g->[$y][$x] eq 'u';
      next if $x == 25 && $y == 32;    # 避免与右肩阴影带构成 2x2 同色
      next unless (($x + $y) % 3) == 0;
      $g->[$y][$x] = ($x <= 15) ? 'U' : 'B';
    }
  }

  # ---- 光影（统一左上光源）----
  span_fill($g,11,15,8,'T');                                  # 额高光（发际下）
  for my $y (9..24) { set_px($g,22,$y,'S'); set_px($g,23,$y,'D') if $y >= 10 && $y <= 22; }  # 右脸阴影带 2 级
  set_px($g,9,14,'S'); set_px($g,9,15,'S'); set_px($g,21,17,'S'); set_px($g,22,17,'S');      # 颧阴影
  span_fill($g,18,20,25,'S'); set_px($g,17,26,'S');          # 下颌右侧收阴

  # ---- 描边 ----
  my $g2 = auto_outline($g);

  # ---- 眉（y9；眉眼分离由 y10 上睑深框线承担，不再另设眉弓阴影行）----
  span_fill($g2,9,13,9,'d'); span_fill($g2,18,22,9,'d');

  # ---- 眼（v1.2 可读性重构：4px 宽 × 3 行高；上睑深框线 + 外眼角框 + 虹膜/瞳孔分离；
  #      内眼角留眼白不做闭合框，避免「眼镜」误读）----
  # 左眼 x10-13 / 右眼 x18-21；y10 上睑深框线，y11-12 睁眼，y13 下睑阴影带
  span_fill($g2,10,13,10,'o'); span_fill($g2,18,21,10,'o');
  for my $s ([10],[18]) {
    my ($lx) = $s->[0];
    set_px($g2,$lx,11,'e');   set_px($g2,$lx+1,11,'e'); set_px($g2,$lx+2,11,'e'); set_px($g2,$lx+3,11,'o');
    set_px($g2,$lx,12,'i');   set_px($g2,$lx+1,12,'i'); set_px($g2,$lx+2,12,'p'); set_px($g2,$lx+3,12,'o');
    set_px($g2,$lx+1,11,'k');
  }
  span_fill($g2,10,13,13,'S'); span_fill($g2,18,21,13,'S');   # 下睑阴影带

  # ---- 鼻（鼻根 y14 / 鼻梁 y15-16 / 鼻翼 y17 / 鼻底阴影 y18；鼻根锚点+深鼻孔分离）----
  set_px($g2,15,14,'n'); set_px($g2,14,14,'S'); set_px($g2,17,14,'S');   # 鼻根+两侧锚点（与颊部分离）
  set_px($g2,15,15,'T'); set_px($g2,16,15,'n');
  set_px($g2,15,16,'T'); set_px($g2,16,16,'n');
  span_fill($g2,14,17,17,'n');
  set_px($g2,14,18,'D'); set_px($g2,17,18,'D');                          # 鼻翼外角深影
  set_px($g2,15,18,'S'); set_px($g2,16,18,'S');                          # 鼻底阴影

  # ---- 嘴（y20-22：上唇深 / 下唇亮 / 唇峰与唇角 / 唇下阴影）----
  set_px($g2,12,20,'M'); span_fill($g2,13,18,20,'m'); set_px($g2,19,20,'M');
  set_px($g2,12,21,'M'); span_fill($g2,13,18,21,'L'); set_px($g2,19,21,'M');
  span_fill($g2,13,18,22,'S');                                 # 唇下阴影
  span_fill($g2,14,17,23,'D');                                 # 唇颏沟（深影，与下颏高光拉开层次）

  # ---- 下颏高光 ----
  span_fill($g2,15,16,25,'T');

  return ($g2, \%PAL);
}

# ---- 对称性校验（描边后中心 15.5 轴，允许描边噪声<=2）----
sub symmetry_check {
  my ($g) = @_;
  my $bad = 0;
  for my $y (0..$H-1) {
    for my $x (0..15) {
      my $a = $g->[$y][$x]; my $b = $g->[$y][31-$x];
      $bad++ if ($a eq '.') ne ($b eq '.');
    }
  }
  return $bad;
}

my ($grid, $pal) = draw_human_male_v11();
my $asym = symmetry_check($grid);
my ($svg, $count) = grid_to_svg($grid, $pal);
my $file = "$OUT/portrait-human-male-v1.2.svg";
open my $fh, '>', $file or die "无法写入 $file: $!";
print $fh $svg;
close $fh;
die "对称性校验失败（不对称像素 $asym > 2）" if $asym > 2;
die "像素量异常（$count < 650）" if $count < 650;
print "OK $file 像素=$count 不对称=$asym\n";
