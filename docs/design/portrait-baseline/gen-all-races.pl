#!/usr/bin/env perl
# 8 种族基准像 SVG 生成器（Perl，纯文本无依赖）
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

# ---- 颜色表（合并所有种族） ----
my %PAL = (
  # 人类
  'human-male' => {
    o=>'#2a1a1a', s=>'#e8b183', S=>'#c17d55', T=>'#f7d3a8',
    h=>'#5b3a24', H=>'#8a5a33', d=>'#4a2f1d',
    e=>'#f5efe6', i=>'#4a6b8a', p=>'#241812', k=>'#ffffff',
    n=>'#b06a45', m=>'#b35a50', M=>'#8a3f38',
    E=>'#d9a077', t=>'#b97a50', u=>'#3a5a8c', U=>'#5a7aac',
  },
  # 精灵
  'elf' => {
    o=>'#2a1a1a', s=>'#f0c8a0', S=>'#d0a078', T=>'#fce8d8',
    h=>'#c8c0d0', H=>'#e8e0f0', d=>'#a098a8',
    e=>'#f5f0f0', i=>'#48a060', p=>'#1a2818', k=>'#ffffff',
    n=>'#c09070', m=>'#c07068', M=>'#985050',
    E=>'#e0b890', t=>'#c09870', u=>'#3a6888', U=>'#5888a8',
  },
  # 矮人
  'dwarf' => {
    o=>'#2a1a1a', s=>'#d8a070', S=>'#b07848', T=>'#f0c8a0',
    h=>'#8a4a22', H=>'#b06a32', d=>'#6a3a18',
    e=>'#f5efe6', i=>'#5a7040', p=>'#1a2010', k=>'#ffffff',
    n=>'#a06840', m=>'#a05848', M=>'#804038',
    f=>'#8a4a22', F=>'#b06a32',
    E=>'#c89060', t=>'#a87040', u=>'#5a4838', U=>'#7a6850',
  },
  # 半身人
  'halfling' => {
    o=>'#2a1a1a', s=>'#e8b888', S=>'#c89060', T=>'#f8d8b0',
    h=>'#6a4020', H=>'#9a6838', d=>'#5a3818',
    e=>'#f5efe6', i=>'#5a8048', p=>'#1a2810', k=>'#ffffff',
    n=>'#b08058', m=>'#c06858', M=>'#985048',
    r=>'#e09888',
    E=>'#d8a878', t=>'#b88858', u=>'#6a5838', U=>'#8a7850',
  },
  # 半兽人
  'half-orc' => {
    o=>'#2a1a1a', s=>'#6a9850', S=>'#4a7830', T=>'#88b870',
    h=>'#1a1a18', H=>'#3a3a30', d=>'#3a5828',
    e=>'#e8e8d0', i=>'#a03020', p=>'#200808', k=>'#ffffff',
    n=>'#4a7828', m=>'#804838', M=>'#603028',
    w=>'#e8e0d0', b=>'#3a5828',
    E=>'#5a8838', t=>'#406820', u=>'#4a3828', U=>'#6a5838',
  },
  # 龙裔
  'dragonborn' => {
    o=>'#1a2a1a', s=>'#708878', S=>'#506858', T=>'#98b8a0',
    c=>'#587868', C=>'#88a898', d=>'#405848',
    e=>'#e0e0c8', i=>'#c88820', p=>'#201008', k=>'#ffffff',
    n=>'#506050', m=>'#605048', M=>'#483838',
    E=>'#607860', t=>'#485848', u=>'#3a4840', U=>'#586858',
  },
  # 侏儒
  'gnome' => {
    o=>'#2a1a1a', s=>'#e8b090', S=>'#c88868', T=>'#f8d0b0',
    h=>'#a83820', H=>'#d05830', d=>'#882818',
    e=>'#f5efe6', i=>'#4878a0', p=>'#182030', k=>'#ffffff',
    n=>'#b07858', m=>'#c06058', M=>'#984848',
    r=>'#e89088',
    E=>'#d8a080', t=>'#b88060', u=>'#5a6848', U=>'#7a8860',
  },
  # 半精灵
  'half-elf' => {
    o=>'#2a1a1a', s=>'#f0c098', S=>'#d09870', T=>'#fce0c8',
    h=>'#7a5a40', H=>'#b8a080', d=>'#5a4030',
    e=>'#f5f0e8', i=>'#4888a0', p=>'#1a2028', k=>'#ffffff',
    n=>'#b88868', m=>'#b86860', M=>'#905048',
    E=>'#d8a880', t=>'#b88860', u=>'#3a5878', U=>'#5878a0',
  },
);

# ---- 网格工具 ----
sub make_grid {
  my @g;
  for my $y (0..$H-1) { $g[$y] = [('.', ) x $W]; }
  return \@g;
}
sub set_px { my ($g,$x,$y,$c) = @_; $g->[$y][$x] = $c if $x>=0 && $x<$W && $y>=0 && $y<$H; }
sub span_fill { my ($g,$x0,$x1,$y,$c) = @_; for my $x ($x0..$x1) { set_px($g,$x,$y,$c); } }
sub rect_fill { my ($g,$x0,$y0,$x1,$y1,$c) = @_; for my $y ($y0..$y1) { span_fill($g,$x0,$x1,$y,$c); } }

sub auto_outline {
  my ($g) = @_;
  # 收集需要变为描边的位置
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
  # 应用描边
  for my $m (@marks) { $g->[$m->[1]][$m->[0]] = 'o'; }
  return $g;
}

sub grid_to_svg {
  my ($g, $pal) = @_;
  my @rects;
  my $count = 0;
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

# ---- 通用绘制 ----
sub draw_ears_normal {
  my ($g, $y0, $y1, $earC, $innerC) = @_;
  for my $y ($y0..$y1) {
    span_fill($g, 6, 7, $y, $earC);
    span_fill($g, 24, 25, $y, $earC);
  }
  set_px($g, 7, $y0+1, $innerC);
  set_px($g, 24, $y0+1, $innerC);
}

sub draw_eyes {
  my ($g, $y, $lx, $rx, $ew, $ir, $pu, $hl) = @_;
  set_px($g,$lx,$y,$ew); set_px($g,$lx+1,$y,$hl); set_px($g,$lx+2,$y,$ew);
  set_px($g,$rx,$y,$ew); set_px($g,$rx+1,$y,$hl); set_px($g,$rx+2,$y,$ew);
  set_px($g,$lx,$y+1,$ir); set_px($g,$lx+1,$y+1,$pu); set_px($g,$lx+2,$y+1,$ir);
  set_px($g,$rx,$y+1,$ir); set_px($g,$rx+1,$y+1,$pu); set_px($g,$rx+2,$y+1,$ir);
}

sub draw_body {
  my ($g, $rows, $base, $hl) = @_;
  for my $y (sort {$a<=>$b} keys %$rows) {
    my ($x0, $x1) = @{$rows->{$y}};
    span_fill($g, $x0, $x1, $y, $base);
  }
  # 领口高光
  my @ys = sort {$a<=>$b} keys %$rows;
  if (@ys >= 2) {
    my ($x0) = @{$rows->{$ys[1]}};
    set_px($g, $x0, $ys[1], $hl);
    set_px($g, $x0+1, $ys[1], $hl);
  }
}

# ============================================================
# 1. 人类男性
# ============================================================
sub draw_human_male {
  my $g = make_grid();
  # 头发
  span_fill($g,12,19,2,'h'); span_fill($g,10,21,3,'h');
  for my $y (4..8) { span_fill($g,8,23,$y,'h'); }
  set_px($g,10,5,'H'); set_px($g,11,5,'H'); set_px($g,11,4,'H'); set_px($g,10,4,'H');
  # 脸
  span_fill($g,10,21,8,'s');
  for my $y (9..24) { span_fill($g,9,22,$y,'s'); }
  span_fill($g,10,21,25,'s'); span_fill($g,11,20,26,'s'); span_fill($g,12,19,27,'s');
  # 耳
  draw_ears_normal($g, 14, 16, 'E', 't');
  # 颈
  span_fill($g,13,18,28,'S'); span_fill($g,13,18,29,'s'); span_fill($g,13,18,30,'s');
  # 身体
  span_fill($g,8,23,30,'u');
  for my $y (31..39) { span_fill($g,5,26,$y,'u'); }
  span_fill($g,12,19,31,'U'); set_px($g,7,31,'U'); set_px($g,7,32,'U');
  # 光影
  span_fill($g,12,14,9,'T');
  for my $y (11..23) { set_px($g,21,$y,'S'); }
  span_fill($g,19,20,25,'S'); set_px($g,18,26,'S');
  # 鬓角
  for my $y (8..12) { span_fill($g,9,10,$y,'h'); span_fill($g,21,22,$y,'h'); }
  # 描边
  my $g2 = auto_outline($g);
  # 五官
  span_fill($g2,10,13,10,'d'); span_fill($g2,18,21,10,'d');
  draw_eyes($g2, 11, 11, 18, 'e','i','p','k');
  # 鼻
  for my $y (15..17) { set_px($g2,15,$y,'T'); set_px($g2,16,$y,'n'); }
  span_fill($g2,15,16,18,'n'); set_px($g2,14,19,'n'); set_px($g2,17,19,'n');
  span_fill($g2,15,16,20,'S');
  # 嘴
  span_fill($g2,13,18,21,'m');
  set_px($g2,13,22,'M'); span_fill($g2,14,17,22,'m'); set_px($g2,18,22,'M');
  span_fill($g2,14,17,23,'S');
  # 下颏高光
  span_fill($g2,15,16,24,'T');
  return ($g2, $PAL{'human-male'});
}

# ============================================================
# 2. 精灵
# ============================================================
sub draw_elf {
  my $g = make_grid();
  # 长发
  span_fill($g,11,20,2,'h'); span_fill($g,9,22,3,'h');
  for my $y (4..8) { span_fill($g,7,24,$y,'h'); }
  set_px($g,9,4,'H'); set_px($g,10,4,'H'); set_px($g,11,5,'H'); set_px($g,9,5,'H');
  # 脸（略窄下颌）
  span_fill($g,10,21,8,'s');
  for my $y (9..24) { span_fill($g,9,22,$y,'s'); }
  span_fill($g,10,21,25,'s'); span_fill($g,11,20,26,'s'); span_fill($g,12,19,27,'s');
  # 尖耳
  for my $y (12..18) { span_fill($g,6,7,$y,'E'); span_fill($g,24,25,$y,'E'); }
  set_px($g,5,11,'E'); set_px($g,5,12,'E'); set_px($g,4,11,'s');
  set_px($g,26,11,'E'); set_px($g,26,12,'E'); set_px($g,27,11,'s');
  set_px($g,3,11,'s'); set_px($g,28,11,'s');
  set_px($g,6,15,'t'); set_px($g,25,15,'t');
  # 长发贴面鬓角
  for my $y (8..18) { set_px($g,8,$y,'h'); set_px($g,23,$y,'h'); }
  # 颈
  span_fill($g,13,18,28,'S'); span_fill($g,13,18,29,'s'); span_fill($g,13,18,30,'s');
  # 身体
  span_fill($g,8,23,30,'u');
  for my $y (31..39) { span_fill($g,5,26,$y,'u'); }
  span_fill($g,12,19,31,'U');
  # 光影
  span_fill($g,12,14,9,'T');
  for my $y (11..23) { set_px($g,21,$y,'S'); }
  # 描边
  my $g2 = auto_outline($g);
  # 五官（纤细眉）
  span_fill($g2,11,13,10,'d'); span_fill($g2,18,20,10,'d');
  draw_eyes($g2, 11, 11, 18, 'e','i','p','k');
  for my $y (15..17) { set_px($g2,15,$y,'T'); set_px($g2,16,$y,'n'); }
  span_fill($g2,15,16,18,'n'); set_px($g2,14,19,'n'); set_px($g2,17,19,'n');
  span_fill($g2,15,16,20,'S');
  # 嘴略小
  span_fill($g2,14,17,21,'m');
  set_px($g2,14,22,'M'); span_fill($g2,15,16,22,'m'); set_px($g2,17,22,'M');
  span_fill($g2,14,17,23,'S');
  span_fill($g2,15,16,24,'T');
  return ($g2, $PAL{'elf'});
}

# ============================================================
# 3. 矮人
# ============================================================
sub draw_dwarf {
  my $g = make_grid();
  # 秃顶 — 头顶皮肤
  span_fill($g,11,20,3,'s'); span_fill($g,9,22,4,'s'); span_fill($g,8,23,5,'s');
  for my $y (6..8) { span_fill($g,8,23,$y,'s'); }
  # 侧发
  for my $y (5..14) { set_px($g,8,$y,'h'); set_px($g,9,$y,'h'); set_px($g,22,$y,'h'); set_px($g,23,$y,'h'); }
  set_px($g,8,5,'H'); set_px($g,9,5,'H');
  # 脸
  for my $y (9..25) { span_fill($g,9,22,$y,'s'); }
  # 耳
  draw_ears_normal($g, 13, 17, 'E', 't');
  # 络腮胡
  for my $y (20..21) { span_fill($g,8,23,$y,'f'); }
  for my $y (22..23) { span_fill($g,9,22,$y,'f'); }
  for my $y (24..25) { span_fill($g,9,22,$y,'f'); }
  for my $y (26..27) { span_fill($g,10,21,$y,'f'); }
  for my $y (28..29) { span_fill($g,11,20,$y,'f'); }
  for my $y (30..31) { span_fill($g,12,19,$y,'f'); }
  # 胡须高光
  set_px($g,12,24,'F'); set_px($g,13,24,'F'); set_px($g,19,25,'F'); set_px($g,20,25,'F');
  # 身体
  span_fill($g,8,23,32,'u');
  for my $y (33..39) { span_fill($g,5,26,$y,'u'); }
  span_fill($g,12,19,32,'U');
  # 光影
  span_fill($g,13,15,4,'T');
  for my $y (10..22) { set_px($g,21,$y,'S'); }
  # 描边
  my $g2 = auto_outline($g);
  # 双层浓眉
  span_fill($g2,9,14,10,'d'); span_fill($g2,17,22,10,'d');
  span_fill($g2,10,13,11,'d'); span_fill($g2,18,21,11,'d');
  draw_eyes($g2, 13, 10, 18, 'e','i','p','k');
  # 大鼻子
  rect_fill($g2,14,17,17,19,'n');
  set_px($g2,15,17,'T');
  # 嘴在胡须中
  span_fill($g2,14,17,21,'m');
  return ($g2, $PAL{'dwarf'});
}

# ============================================================
# 4. 半身人
# ============================================================
sub draw_halfling {
  my $g = make_grid();
  # 蓬松卷发
  span_fill($g,10,21,2,'h'); span_fill($g,8,23,3,'h');
  for my $y (4..7) { span_fill($g,7,24,$y,'h'); }
  span_fill($g,8,23,8,'h');
  set_px($g,9,3,'H'); set_px($g,10,3,'H'); set_px($g,7,4,'H');
  # 脸（圆润）
  span_fill($g,10,21,8,'s');
  for my $y (9..24) { span_fill($g,9,22,$y,'s'); }
  span_fill($g,10,21,25,'s'); span_fill($g,11,20,26,'s'); span_fill($g,12,19,27,'s');
  # 耳
  draw_ears_normal($g, 14, 16, 'E', 't');
  # 颈
  span_fill($g,13,18,28,'S'); span_fill($g,13,18,29,'s'); span_fill($g,13,18,30,'s');
  # 身体
  span_fill($g,8,23,30,'u');
  for my $y (31..39) { span_fill($g,5,26,$y,'u'); }
  span_fill($g,12,19,31,'U');
  # 光影
  span_fill($g,12,14,9,'T');
  for my $y (11..23) { set_px($g,21,$y,'S'); }
  # 腮红
  set_px($g,10,17,'r'); set_px($g,10,18,'r');
  set_px($g,21,17,'r'); set_px($g,21,18,'r');
  # 描边
  my $g2 = auto_outline($g);
  span_fill($g2,10,13,10,'d'); span_fill($g2,18,21,10,'d');
  draw_eyes($g2, 11, 11, 18, 'e','i','p','k');
  for my $y (15..17) { set_px($g2,15,$y,'T'); set_px($g2,16,$y,'n'); }
  span_fill($g2,15,16,18,'n'); set_px($g2,14,19,'n'); set_px($g2,17,19,'n');
  span_fill($g2,15,16,20,'S');
  span_fill($g2,13,18,21,'m');
  set_px($g2,13,22,'M'); span_fill($g2,14,17,22,'m'); set_px($g2,18,22,'M');
  span_fill($g2,14,17,23,'S');
  span_fill($g2,15,16,24,'T');
  return ($g2, $PAL{'halfling'});
}

# ============================================================
# 5. 半兽人
# ============================================================
sub draw_half_orc {
  my $g = make_grid();
  # 短发
  span_fill($g,11,20,3,'h'); span_fill($g,9,22,4,'h');
  for my $y (5..7) { span_fill($g,8,23,$y,'h'); }
  set_px($g,10,4,'H'); set_px($g,11,4,'H');
  # 脸（宽下颌）
  span_fill($g,9,22,7,'s');
  for my $y (8..25) { span_fill($g,9,22,$y,'s'); }
  span_fill($g,10,21,26,'s'); span_fill($g,11,20,27,'s');
  # 微尖耳
  for my $y (13..16) { span_fill($g,6,7,$y,'E'); span_fill($g,24,25,$y,'E'); }
  set_px($g,5,12,'E'); set_px($g,26,12,'E');
  set_px($g,7,14,'t'); set_px($g,24,14,'t');
  # 颈
  span_fill($g,13,18,28,'S'); span_fill($g,13,18,29,'s'); span_fill($g,13,18,30,'s');
  # 身体
  span_fill($g,8,23,30,'u');
  for my $y (31..39) { span_fill($g,5,26,$y,'u'); }
  span_fill($g,12,19,31,'U');
  # 光影
  span_fill($g,12,14,9,'T');
  for my $y (10..24) { set_px($g,21,$y,'S'); }
  # 描边
  my $g2 = auto_outline($g);
  # 粗重眉脊
  span_fill($g2,9,14,10,'b'); span_fill($g2,17,22,10,'b');
  draw_eyes($g2, 12, 11, 18, 'e','i','p','k');
  for my $y (16..18) { set_px($g2,15,$y,'T'); set_px($g2,16,$y,'n'); }
  span_fill($g2,15,16,19,'n'); set_px($g2,14,20,'n'); set_px($g2,17,20,'n');
  span_fill($g2,15,16,21,'S');
  # 嘴
  span_fill($g2,13,18,22,'m');
  set_px($g2,13,23,'M'); span_fill($g2,14,17,23,'m'); set_px($g2,18,23,'M');
  # 獠牙
  set_px($g2,13,24,'w'); set_px($g2,13,25,'w');
  set_px($g2,18,24,'w'); set_px($g2,18,25,'w');
  return ($g2, $PAL{'half-orc'});
}

# ============================================================
# 6. 龙裔
# ============================================================
sub draw_dragonborn {
  my $g = make_grid();
  # 无发 — 鳞片头顶
  for my $y (2..8) { span_fill($g,9,22,$y,'s'); }
  # 鳞片纹理
  set_px($g,12,3,'c'); set_px($g,15,3,'c'); set_px($g,18,3,'c');
  set_px($g,11,5,'c'); set_px($g,14,5,'c'); set_px($g,17,5,'c'); set_px($g,20,5,'c');
  set_px($g,12,7,'C'); set_px($g,16,7,'C');
  # 面部鳞片
  set_px($g,19,14,'c'); set_px($g,20,16,'c'); set_px($g,21,17,'c');
  set_px($g,12,9,'C'); set_px($g,13,10,'C');
  # 小耳
  for my $y (13..15) { set_px($g,7,$y,'E'); set_px($g,24,$y,'E'); }
  # 颈（带鳞片）
  span_fill($g,13,18,28,'S'); span_fill($g,13,18,29,'s'); span_fill($g,13,18,30,'s');
  set_px($g,14,29,'c'); set_px($g,17,29,'c');
  # 身体
  span_fill($g,8,23,30,'u');
  for my $y (31..39) { span_fill($g,5,26,$y,'u'); }
  span_fill($g,12,19,31,'U');
  # 光影
  span_fill($g,12,14,9,'T');
  for my $y (11..23) { set_px($g,21,$y,'S'); }
  # 描边
  my $g2 = auto_outline($g);
  # 眉脊
  span_fill($g2,10,13,10,'d'); span_fill($g2,18,21,10,'d');
  draw_eyes($g2, 11, 11, 18, 'e','i','p','k');
  # 吻部
  rect_fill($g2,14,16,17,19,'n');
  set_px($g2,15,16,'T'); set_px($g2,15,17,'T');
  set_px($g2,14,20,'S'); set_px($g2,17,20,'S');
  # 嘴
  span_fill($g2,13,18,21,'m');
  set_px($g2,13,22,'M'); span_fill($g2,14,17,22,'m'); set_px($g2,18,22,'M');
  return ($g2, $PAL{'dragonborn'});
}

# ============================================================
# 7. 侏儒
# ============================================================
sub draw_gnome {
  my $g = make_grid();
  # 极蓬松野发
  span_fill($g,9,22,2,'h'); span_fill($g,7,24,3,'h');
  for my $y (4..5) { span_fill($g,6,25,$y,'h'); }
  for my $y (6..7) { span_fill($g,7,24,$y,'h'); }
  span_fill($g,8,23,8,'h');
  set_px($g,8,2,'H'); set_px($g,9,2,'H'); set_px($g,24,3,'H'); set_px($g,25,4,'H');
  # 脸
  span_fill($g,10,21,8,'s');
  for my $y (9..24) { span_fill($g,9,22,$y,'s'); }
  span_fill($g,10,21,25,'s'); span_fill($g,11,20,26,'s'); span_fill($g,12,19,27,'s');
  # 耳
  draw_ears_normal($g, 14, 16, 'E', 't');
  # 颈
  span_fill($g,13,18,28,'S'); span_fill($g,13,18,29,'s'); span_fill($g,13,18,30,'s');
  # 身体
  span_fill($g,8,23,30,'u');
  for my $y (31..39) { span_fill($g,5,26,$y,'u'); }
  span_fill($g,12,19,31,'U');
  # 光影
  span_fill($g,12,14,9,'T');
  for my $y (11..23) { set_px($g,21,$y,'S'); }
  # 腮红
  set_px($g,10,16,'r'); set_px($g,10,17,'r');
  set_px($g,21,16,'r'); set_px($g,21,17,'r');
  # 描边
  my $g2 = auto_outline($g);
  # 大眼（4px 宽）
  span_fill($g2,10,13,10,'d'); span_fill($g2,18,21,10,'d');
  set_px($g2,10,11,'e'); set_px($g2,11,11,'k'); set_px($g2,12,11,'e'); set_px($g2,13,11,'e');
  set_px($g2,10,12,'i'); set_px($g2,11,12,'p'); set_px($g2,12,12,'i'); set_px($g2,13,12,'i');
  set_px($g2,18,11,'e'); set_px($g2,19,11,'e'); set_px($g2,20,11,'k'); set_px($g2,21,11,'e');
  set_px($g2,18,12,'i'); set_px($g2,19,12,'i'); set_px($g2,20,12,'p'); set_px($g2,21,12,'i');
  for my $y (15..17) { set_px($g2,15,$y,'T'); set_px($g2,16,$y,'n'); }
  span_fill($g2,15,16,18,'n'); set_px($g2,14,19,'n'); set_px($g2,17,19,'n');
  span_fill($g2,15,16,20,'S');
  span_fill($g2,13,18,21,'m');
  set_px($g2,13,22,'M'); span_fill($g2,14,17,22,'m'); set_px($g2,18,22,'M');
  span_fill($g2,14,17,23,'S');
  span_fill($g2,15,16,24,'T');
  return ($g2, $PAL{'gnome'});
}

# ============================================================
# 8. 半精灵
# ============================================================
sub draw_half_elf {
  my $g = make_grid();
  # 中长发
  span_fill($g,11,20,2,'h'); span_fill($g,9,22,3,'h');
  for my $y (4..8) { span_fill($g,7,24,$y,'h'); }
  set_px($g,10,4,'H'); set_px($g,11,4,'H'); set_px($g,9,5,'H');
  # 脸（略窄）
  span_fill($g,10,21,8,'s');
  for my $y (9..24) { span_fill($g,9,22,$y,'s'); }
  span_fill($g,10,21,25,'s'); span_fill($g,11,20,26,'s'); span_fill($g,12,19,27,'s');
  # 微尖耳
  for my $y (13..17) { span_fill($g,6,7,$y,'E'); span_fill($g,24,25,$y,'E'); }
  set_px($g,5,12,'E'); set_px($g,5,13,'E');
  set_px($g,26,12,'E'); set_px($g,26,13,'E');
  set_px($g,6,15,'t'); set_px($g,25,15,'t');
  # 中长鬓角
  for my $y (8..14) { set_px($g,8,$y,'h'); set_px($g,23,$y,'h'); }
  # 颈
  span_fill($g,13,18,28,'S'); span_fill($g,13,18,29,'s'); span_fill($g,13,18,30,'s');
  # 身体
  span_fill($g,8,23,30,'u');
  for my $y (31..39) { span_fill($g,5,26,$y,'u'); }
  span_fill($g,12,19,31,'U');
  # 光影
  span_fill($g,12,14,9,'T');
  for my $y (11..23) { set_px($g,21,$y,'S'); }
  # 描边
  my $g2 = auto_outline($g);
  span_fill($g2,10,13,10,'d'); span_fill($g2,18,21,10,'d');
  draw_eyes($g2, 11, 11, 18, 'e','i','p','k');
  for my $y (15..17) { set_px($g2,15,$y,'T'); set_px($g2,16,$y,'n'); }
  span_fill($g2,15,16,18,'n'); set_px($g2,14,19,'n'); set_px($g2,17,19,'n');
  span_fill($g2,15,16,20,'S');
  span_fill($g2,13,18,21,'m');
  set_px($g2,13,22,'M'); span_fill($g2,14,17,22,'m'); set_px($g2,18,22,'M');
  span_fill($g2,14,17,23,'S');
  span_fill($g2,15,16,24,'T');
  return ($g2, $PAL{'half-elf'});
}

# ============================================================
# 主流程
# ============================================================
my @RACES = (
  ['human-male', '人类男性', \&draw_human_male],
  ['elf',        '精灵',     \&draw_elf],
  ['dwarf',      '矮人',     \&draw_dwarf],
  ['halfling',   '半身人',   \&draw_halfling],
  ['half-orc',   '半兽人',   \&draw_half_orc],
  ['dragonborn', '龙裔',     \&draw_dragonborn],
  ['gnome',      '侏儒',     \&draw_gnome],
  ['half-elf',   '半精灵',   \&draw_half_elf],
);

my $ok = 0; my $fail = 0;
print "========== 8 种族基准像 SVG 生成 ==========\n\n";

for my $race (@RACES) {
  my ($id, $name, $fn) = @$race;
  eval {
    my ($grid, $pal) = $fn->();
    my ($svg, $count) = grid_to_svg($grid, $pal);
    my $path = "$OUT/portrait-$id-v1.0.svg";
    open my $fh, '>', $path or die "无法写入 $path: $!";
    print $fh $svg;
    close $fh;
    my $size = -s $path;
    die "文件过小: ${size}B" if $size < 100;
    die "像素不足: $count" if $count < 200;
    printf "  OK: %s (%s) — %d px, %d B\n", $name, $id, $count, $size;
    $ok++;
  };
  if ($@) {
    printf "  FAIL: %s (%s) — %s\n", $name, $id, $@;
    $fail++;
    unlink "$OUT/portrait-$id-v1.0.svg" if -e "$OUT/portrait-$id-v1.0.svg";
  }
}

printf "\n========== 生成报告 ==========\n";
printf "成功: %d/%d\n", $ok, scalar @RACES;
printf "失败: %d\n", $fail if $fail;
printf "输出目录: $OUT\n";
exit($fail > 0 ? 1 : 0);
