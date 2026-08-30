#!/usr/bin/env perl
# S3-1 七种族基准像 v1.1 批量生成器（人类男性定稿已单独入库）
# 基底：人类男性 v1.1/v1.2 面部结构（16px 脸颊、5 级肤色、眼窝/鼻侧影/唇下深影）
#       + v1.2 服装绘制规则（领口/肩光/衣褶/下摆/斜纹 dithering）
# 叠加：各种族肤色阶/发色/瞳色/耳型/专属特征（尖耳/络腮胡/獠牙/鳞片/腮红/大眼等）
# 画布 32x40, SCALE=12, 输出 384x480 SVG（迭代样图，不入库）
use strict;
use warnings;
use File::Basename;
use File::Path qw(make_path);

my $DIR = dirname($0);
my $OUT = "$DIR/output";
make_path($OUT);

my $W = 32; my $H = 40; my $S = 12;
my $BG = '#1c1824';

# ---- 种族色板（字符语义统一：s基肤/S阴影/D深影/T高光/颈同肤阶；u/U/B服装基/亮/暗）----
my %RACE_PAL = (
  'elf' => {
    o=>'#2a1a1a', s=>'#f0c8a0', S=>'#d0a078', D=>'#b88a60', T=>'#fce8d8',
    h=>'#c8c0d0', H=>'#e8e0f0', d=>'#a098a8',
    e=>'#f5f0f0', i=>'#48a060', p=>'#1a2818', k=>'#ffffff',
    n=>'#c09070', m=>'#c07068', M=>'#985050', L=>'#d08878',
    E=>'#e0b890', t=>'#c09870', u=>'#3a6888', U=>'#5888a8', B=>'#2a4a66',
  },
  'dwarf' => {
    o=>'#2a1a1a', s=>'#d8a070', S=>'#b07848', D=>'#96603a', T=>'#f0c8a0',
    h=>'#8a4a22', H=>'#b06a32', d=>'#6a3a18', f=>'#8a4a22', F=>'#b06a32',
    e=>'#f5efe6', i=>'#5a7040', p=>'#1a2010', k=>'#ffffff',
    n=>'#a06840', m=>'#b85a4a', M=>'#8a3830', L=>'#c86a58',
    E=>'#c89060', t=>'#a87040', u=>'#5a4838', U=>'#7a6850', B=>'#3a2e22',
  },
  'halfling' => {
    o=>'#2a1a1a', s=>'#e8b888', S=>'#c89060', D=>'#a8744a', T=>'#f8d8b0',
    h=>'#6a4020', H=>'#9a6838', d=>'#5a3818', r=>'#e09888',
    e=>'#f5efe6', i=>'#5a8048', p=>'#1a2810', k=>'#ffffff',
    n=>'#b08058', m=>'#c06858', M=>'#985048', L=>'#d07a68',
    E=>'#d8a878', t=>'#b88858', u=>'#6a5838', U=>'#8a7850', B=>'#4a3c24',
  },
  'half-orc' => {
    o=>'#2a1a1a', s=>'#6a9850', S=>'#4a7830', D=>'#386222', T=>'#88b870',
    h=>'#1a1a18', H=>'#3a3a30', d=>'#2a3a20', b=>'#3a5828', f=>'#2e4a20',
    e=>'#e8e8d0', i=>'#a03020', p=>'#200808', k=>'#ffffff',
    n=>'#4a7828', m=>'#804838', M=>'#603028', L=>'#94584a', w=>'#e8e0d0',
    E=>'#5a8838', t=>'#406820', u=>'#4a3828', U=>'#6a5838', B=>'#322618',
  },
  'dragonborn' => {
    o=>'#1a2418', s=>'#708878', S=>'#506858', D=>'#405444', T=>'#98b8a0',
    h=>'#587868', H=>'#88a898', d=>'#405848', c=>'#3e584a', C=>'#86a890',
    e=>'#e0e0c8', i=>'#c88820', p=>'#201008', k=>'#ffffff',
    n=>'#506050', m=>'#4a4238', M=>'#28221a', L=>'#7a6e58',
    E=>'#607860', t=>'#485848', u=>'#3a4840', U=>'#586858', B=>'#242e28',
  },
  'gnome' => {
    o=>'#2a1a1a', s=>'#e8b090', S=>'#c88868', D=>'#a86c50', T=>'#f8d0b0',
    h=>'#a83820', H=>'#d05830', d=>'#882818', r=>'#e89088',
    e=>'#f5efe6', i=>'#4878a0', p=>'#182030', k=>'#ffffff',
    n=>'#b07858', m=>'#c06058', M=>'#984848', L=>'#d07268',
    E=>'#d8a080', t=>'#b88060', u=>'#5a6848', U=>'#7a8860', B=>'#3e4a30',
  },
  'half-elf' => {
    o=>'#2a1a1a', s=>'#f0c098', S=>'#d09870', D=>'#b47c58', T=>'#fce0c8',
    h=>'#7a5a40', H=>'#b8a080', d=>'#5a4030',
    e=>'#f5f0e8', i=>'#4888a0', p=>'#1a2028', k=>'#ffffff',
    n=>'#b88868', m=>'#b86860', M=>'#905048', L=>'#c87a70',
    E=>'#d8a880', t=>'#b88860', u=>'#3a5878', U=>'#5878a0', B=>'#2a4058',
  },
);

# ---- 种族几何/特征配置 ----
my %CFG = (
  'elf'        => { face_x0=>8,  face_x1=>23, ears=>'pointed',     hair=>'long',    eyes=>'std', brows=>'slim',  nose=>'std',  mouth=>'std' },
  'dwarf'      => { face_x0=>8,  face_x1=>23, ears=>'normal',      hair=>'bald',    eyes=>'low', brows=>'thick', nose=>'broad', mouth=>'beard' },
  'halfling'   => { face_x0=>8,  face_x1=>23, ears=>'normal',      hair=>'curly',   eyes=>'std', brows=>'std',   nose=>'std',  mouth=>'std', blush=>1 },
  'half-orc'   => { face_x0=>7,  face_x1=>24, ears=>'halfpoint',   hair=>'buzz',    eyes=>'low', brows=>'ridge', nose=>'broad', mouth=>'tusks' },
  'dragonborn' => { face_x0=>8,  face_x1=>23, ears=>'small',       hair=>'none',    eyes=>'std', brows=>'ridge', nose=>'snout', mouth=>'snout' },
  'gnome'      => { face_x0=>8,  face_x1=>23, ears=>'normal',      hair=>'wild',    eyes=>'big', brows=>'std',   nose=>'std',  mouth=>'std', blush=>1 },
  'half-elf'   => { face_x0=>8,  face_x1=>23, ears=>'halfpoint',   hair=>'medium',  eyes=>'std', brows=>'slim',  nose=>'std',  mouth=>'std' },
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
  $g->[$_->[1]][$_->[0]] = 'o' for @marks;
  return $g;
}

# ---- 躯干（v1.2 服装绘制规则：领口/肩光/衣褶/下摆/斜纹 dithering）----
sub render_body {
  my ($g, $cfg, $pal) = @_;
  my $wide = $cfg->{face_x0} < 8;
  my ($bx0, $bx1) = $wide ? (4, 27) : (5, 26);
  span_fill($g, 8, 23, 30, 'u');
  for my $y (31..39) { span_fill($g, $bx0, $bx1, $y, 'u'); }
  span_fill($g, 9, 12, 30, 'U'); span_fill($g, 19, 22, 30, 'U');        # 肩部高光
  span_fill($g, 12, 19, 31, 'B');                                        # 领口阴影带
  span_fill($g, 13, 18, 32, 'U'); set_px($g, 12, 32, 'B'); set_px($g, 19, 32, 'B');  # 领口亮带+领角
  span_fill($g, $bx0, $bx0+1, 31, 'U'); set_px($g, $bx0, 32, 'U');       # 左肩亮带
  span_fill($g, $bx1-1, $bx1, 31, 'B'); set_px($g, $bx1, 32, 'B'); set_px($g, $bx1, 33, 'B');  # 右肩阴影带
  set_px($g,10,33,'B'); set_px($g,9,34,'B'); set_px($g,9,35,'B'); set_px($g,8,36,'B');          # 左斜褶
  set_px($g,11,34,'U'); set_px($g,10,35,'U');
  set_px($g,21,33,'B'); set_px($g,22,34,'B'); set_px($g,22,35,'B'); set_px($g,23,36,'B');       # 右纵褶
  set_px($g,20,34,'U'); set_px($g,21,35,'U');
  set_px($g,15,35,'B'); set_px($g,16,36,'B'); set_px($g,16,37,'B');      # 中腹褶
  span_fill($g, 7, 9, 38, 'B'); span_fill($g, 22, 24, 38, 'B');          # 下摆阴影
  set_px($g,15,39,'B'); set_px($g,16,39,'B');
  for my $y (30..39) {                                                    # 斜纹 dithering
    for my $x ($bx0..$bx1) {
      next unless $g->[$y][$x] eq 'u';
      next if $x == $bx1-1 && $y == 32;
      next unless (($x + $y) % 3) == 0;
      $g->[$y][$x] = ($x <= 15) ? 'U' : 'B';
    }
  }
}

# ---- 发型 ----
sub render_hair {
  my ($g, $cfg, $pal) = @_;
  my $t = $cfg->{hair};
  if ($t eq 'long') {
    span_fill($g,11,20,1,'h'); span_fill($g,10,21,2,'h');
    for my $y (3..7) { span_fill($g,7,24,$y,'h'); }
    set_px($g,9,3,'H'); set_px($g,10,3,'H'); set_px($g,10,2,'H'); set_px($g,11,2,'H');
    set_px($g,8,4,'H'); set_px($g,13,4,'H'); set_px($g,15,5,'H');
    set_px($g,20,4,'d'); set_px($g,21,5,'d'); set_px($g,19,6,'d');
    # 冠顶不规则发冠（消除帽子误读）：y0 起伏发尖全覆盖 + 明暗交替，发顶轮廓参差非平滑穹面
    for my $p ([10,0,'h'],[12,0,'H'],[13,0,'h'],[15,0,'h'],[16,0,'H'],[18,0,'h'],[19,0,'d'],[21,0,'h']) {
      set_px($g,$p->[0],$p->[1],$p->[2]);
    }
    set_px($g,11,1,'H'); set_px($g,14,1,'h'); set_px($g,17,1,'d'); set_px($g,20,1,'H');
    # 明暗断续发缕（左受光亮缕 / 右背光暗缕，避免连续深纵线被读作头盔纵脊）
    set_px($g,13,2,'H'); set_px($g,13,4,'h'); set_px($g,13,5,'H'); set_px($g,13,7,'h');
    set_px($g,18,3,'d'); set_px($g,18,4,'h'); set_px($g,18,6,'d'); set_px($g,18,7,'h');
    # 贴面发丝移至 render_hair_front（面部填色之后），避免被擦除
  } elsif ($t eq 'medium') {
    span_fill($g,11,20,1,'h'); span_fill($g,10,21,2,'h');
    for my $y (3..7) { span_fill($g,7,24,$y,'h'); }
    set_px($g,9,3,'H'); set_px($g,10,3,'H'); set_px($g,10,2,'H'); set_px($g,11,2,'H');
    set_px($g,8,4,'H'); set_px($g,14,4,'H');
    set_px($g,20,4,'d'); set_px($g,21,5,'d'); set_px($g,19,6,'d');
    # 发丝纹理（左受光/右背光，高暗交替），消除平涂帽状误读
    set_px($g,12,3,'H'); set_px($g,10,5,'H'); set_px($g,13,6,'H'); set_px($g,9,7,'H');
    set_px($g,18,3,'d'); set_px($g,21,4,'d'); set_px($g,17,6,'d'); set_px($g,22,6,'d'); set_px($g,20,7,'d');
    # 冠顶参差碎发（左右高低发尖）+ 垂直发缝暗线（破穹面平涂）
    set_px($g,12,0,'h'); set_px($g,15,0,'H'); set_px($g,19,0,'d');
    set_px($g,10,1,'H'); set_px($g,21,1,'d'); set_px($g,17,1,'h');
    set_px($g,13,2,'d'); set_px($g,13,5,'d'); set_px($g,18,3,'d'); set_px($g,18,6,'d');
    # 贴面发丝移至 render_hair_front（面部填色之后），避免被擦除
  } elsif ($t eq 'curly') {
    span_fill($g,11,20,1,'h'); span_fill($g,9,22,2,'h');
    for my $y (3..7) { span_fill($g,7,24,$y,'h'); }
    for my $p ([10,2],[13,2],[16,2],[19,2],[8,4],[11,4],[14,4],[17,4],[20,4],[9,6],[13,6],[17,6],[21,6]) {
      set_px($g,$p->[0],$p->[1],'H');
    }
    for my $p ([11,3],[15,3],[19,3],[10,5],[14,5],[18,5],[22,5]) { set_px($g,$p->[0],$p->[1],'d'); }
    for my $y (8..11) { set_px($g,8,$y,'h'); set_px($g,23,$y,'h'); }
  } elsif ($t eq 'wild') {
    span_fill($g,11,20,1,'h'); span_fill($g,9,22,2,'h');
    span_fill($g,8,23,3,'h'); span_fill($g,7,24,4,'h');
    span_fill($g,8,23,5,'h'); span_fill($g,8,23,6,'h');
    span_fill($g,9,22,7,'h');
    set_px($g,10,0,'h'); set_px($g,21,0,'d'); set_px($g,14,0,'H'); set_px($g,17,0,'h');   # 顶部参差碎发（左亮右暗）
    set_px($g,8,1,'H');  set_px($g,23,1,'d');                                             # 冠缘（左受光/右暗缺）
    set_px($g,6,3,'h');  set_px($g,25,3,'d');                                             # 侧飞蓬发
    set_px($g,5,5,'H');  set_px($g,26,5,'d');
    set_px($g,6,7,'h');  set_px($g,25,7,'h');                                             # 低位飞丝
    set_px($g,5,8,'d');  set_px($g,26,8,'d');
    for my $p ([10,2],[13,3],[9,4],[12,6],[9,6],[14,5]) { set_px($g,$p->[0],$p->[1],'H'); }   # 左侧卷曲高光
    for my $p ([20,3],[18,4],[22,5],[19,6],[21,2],[16,5]) { set_px($g,$p->[0],$p->[1],'d'); } # 右侧发层暗部
    # 鬓角蓬发与锯齿刘海移至 render_hair_front（面部填色之后）
  } elsif ($t eq 'buzz') {
    span_fill($g,12,19,2,'h'); span_fill($g,10,21,3,'h');
    for my $y (4..7) { span_fill($g,8,23,$y,'h'); }
    set_px($g,11,3,'H'); set_px($g,12,3,'H'); set_px($g,10,4,'H');
    set_px($g,19,5,'d'); set_px($g,20,6,'d');
    for my $y (8..10) { set_px($g,8,$y,'h'); set_px($g,23,$y,'h'); }
  } elsif ($t eq 'bald') {
    span_fill($g,13,18,1,'s'); span_fill($g,11,20,2,'s');
    for my $y (3..5) { span_fill($g,10,21,$y,'s'); }
    # 秃顶油光：不规则稀疏 T 散点（任意两点不同行相邻，绝不构成横向亮带/暗带），
    # 头顶大面积保持肤色，消除「束发带/帽子」误读；暗部仅右侧 2 点随光源
    set_px($g,13,2,'T'); set_px($g,16,3,'T'); set_px($g,14,3,'T');
    set_px($g,12,4,'T'); set_px($g,18,4,'T');
    set_px($g,19,3,'S'); set_px($g,20,4,'S');
    for my $y (5..13) { set_px($g,8,$y,'h'); set_px($g,9,$y,'h'); set_px($g,22,$y,'h'); set_px($g,23,$y,'h'); }  # 两侧发
    set_px($g,8,6,'H'); set_px($g,9,6,'H'); set_px($g,22,8,'d'); set_px($g,23,9,'d');
  } elsif ($t eq 'none') {
    for my $y (1..2) { span_fill($g,11,20,$y,'s'); }
    span_fill($g,10,21,3,'s'); span_fill($g,9,22,4,'s');
    for my $y (5..7) { span_fill($g,8,23,$y,'s'); }
    span_fill($g,12,16,2,'T');                                            # 颅顶高光
    # 头鳞：不规则错落鳞簇（占位镜像对称，疏密不均/边缘参差/局部留肤色基底，
    # 明暗交错不连成网格线，消除「格子帽/织物」误读；受光侧偏亮、背光侧偏暗）
    set_px($g,12,3,'C'); set_px($g,13,3,'c'); set_px($g,15,3,'C');        # 顶鳞簇（跨行簇，中部留空）
    set_px($g,18,3,'c'); set_px($g,19,3,'c');
    set_px($g,10,4,'C'); set_px($g,11,4,'C');                             # 左鳞簇（亮）
    span_fill($g,14,17,4,'c'); set_px($g,15,4,'C');                       # 中鳞簇（亮暗混）
    set_px($g,20,4,'c'); set_px($g,21,4,'c');                             # 右鳞簇（暗）
    set_px($g,9,5,'C');  set_px($g,13,5,'C'); set_px($g,14,5,'c');        # 左中疏排
    set_px($g,17,5,'C'); set_px($g,18,5,'c'); set_px($g,22,5,'c');        # 右中（中央留肤色基底）
    set_px($g,9,6,'c');  set_px($g,10,6,'C'); set_px($g,12,6,'C');        # 底层左鳞
    set_px($g,15,6,'c'); set_px($g,16,6,'C');                             # 底层中鳞（错位）
    set_px($g,19,6,'c'); set_px($g,21,6,'c'); set_px($g,22,6,'c');        # 底层右鳞
  }
}

# ---- 前层发（面部填色之后重绘，防止被 span_fill 擦除）----
sub render_hair_front {
  my ($g, $cfg) = @_;
  my $t = $cfg->{hair};
  if ($t eq 'long') {
    for my $y (8..21) { set_px($g,8,$y,'h'); set_px($g,23,$y,'h'); }     # 长发贴面下延至颈侧
    set_px($g,8,9,'H');  set_px($g,8,13,'H'); set_px($g,8,17,'H');       # 左束受光
    set_px($g,8,11,'d'); set_px($g,8,20,'d');
    set_px($g,23,10,'d'); set_px($g,23,14,'d'); set_px($g,23,18,'d');    # 右束背光
    set_px($g,23,21,'d');
    for my $y (18..27) { set_px($g,8,$y,'h'); set_px($g,23,$y,'h'); }    # 耳下垂落发束（贴脸沿下颌至肩）
    set_px($g,8,20,'H'); set_px($g,8,24,'d');                            # 左垂束
    set_px($g,23,19,'d'); set_px($g,23,23,'d'); set_px($g,23,26,'d');    # 右垂束
    # 参差刘海（破坏发底平直边缘，消除「帽檐」读感）：y8 锯齿发尖 + y9 两撮深发
    for my $x (10,12,15,16,19,21) { set_px($g,$x,8,'h'); }
    set_px($g,9,9,'h'); set_px($g,22,9,'h');
    set_px($g,11,8,'H'); set_px($g,20,8,'d');                            # 刘海左受光/右背光
  } elsif ($t eq 'buzz') {
    # 发际线参差化（消除平头「头盔」读感）：y8 锯齿发尖 + 发-肤过渡色 + y7 肤色缺口
    for my $x (9,11,14,17,20,22) { set_px($g,$x,8,'h'); }
    set_px($g,10,8,'b'); set_px($g,21,8,'b');                            # 发际过渡（发色渗入肤色）
    set_px($g,10,7,'s'); set_px($g,21,7,'s'); set_px($g,15,7,'s'); set_px($g,16,7,'s');  # y7 肤色缺口
  } elsif ($t eq 'medium') {
    for my $y (8..16) { set_px($g,8,$y,'h'); set_px($g,23,$y,'h'); }     # 中长发过耳垂
    set_px($g,8,10,'H'); set_px($g,8,14,'H');                            # 左束受光
    set_px($g,23,11,'d'); set_px($g,23,15,'d'); set_px($g,23,16,'d');    # 右束背光
    for my $y (17..24) { set_px($g,8,$y,'h'); set_px($g,23,$y,'h'); }    # 耳下垂发束下延过下颌（弱点2：发长读感）
    for my $y (19..24) { set_px($g,7,$y,'h'); set_px($g,24,$y,'h'); }    # 下段加宽 2px，发量可读
    set_px($g,8,18,'H'); set_px($g,8,22,'H'); set_px($g,7,21,'H');       # 左垂束受光
    set_px($g,23,19,'d'); set_px($g,23,23,'d'); set_px($g,24,22,'d');    # 右垂束背光
    set_px($g,8,24,'H'); set_px($g,23,24,'d'); set_px($g,7,24,'h'); set_px($g,24,24,'d');  # 发梢参差（左亮右暗，非平齐切边）
  } elsif ($t eq 'wild') {
    for my $y (8..12) { set_px($g,8,$y,'h'); set_px($g,23,$y,'h'); }     # 蓬乱鬓角
    set_px($g,7,9,'h');  set_px($g,24,9,'h');
    set_px($g,7,11,'d'); set_px($g,24,11,'d');
    set_px($g,8,9,'H');  set_px($g,23,10,'d');                           # 左亮右暗
    for my $p ([10,8],[12,8],[16,8],[19,8]) { set_px($g,$p->[0],$p->[1],'h'); }   # 锯齿刘海
    set_px($g,11,8,'H'); set_px($g,17,8,'d');
  }
}

# ---- 耳 ----
sub render_ears {
  my ($g, $cfg) = @_;
  my $t = $cfg->{ears};
  if ($t eq 'normal') {
    for my $y (13..16) { span_fill($g,6,7,$y,'E'); span_fill($g,24,25,$y,'E'); }
    set_px($g,7,14,'t'); set_px($g,24,14,'t');
  } elsif ($t eq 'halfpoint') {
    for my $y (12..16) { span_fill($g,6,7,$y,'E'); span_fill($g,24,25,$y,'E'); }
    set_px($g,5,11,'E'); set_px($g,4,10,'E');                            # 微尖耳廓（2 级上挑）
    set_px($g,26,11,'E'); set_px($g,27,10,'E');
    set_px($g,5,11,'T'); set_px($g,26,11,'T');                           # 耳尖受光
    set_px($g,6,13,'t'); set_px($g,25,13,'t');                           # 耳窝阴影
    set_px($g,7,14,'t'); set_px($g,24,14,'t');
  } elsif ($t eq 'pointed') {
    for my $y (12..17) { span_fill($g,6,7,$y,'E'); span_fill($g,24,25,$y,'E'); }
    set_px($g,5,12,'E'); set_px($g,5,11,'E'); set_px($g,4,10,'E'); set_px($g,3,9,'E');   # 尖耳上挑 4 级
    set_px($g,26,12,'E'); set_px($g,26,11,'E'); set_px($g,27,10,'E'); set_px($g,28,9,'E');
    set_px($g,4,10,'T'); set_px($g,27,10,'T');                           # 耳尖受光
    set_px($g,5,12,'t'); set_px($g,26,12,'t');                           # 耳廓边缘阴影
    set_px($g,6,14,'t'); set_px($g,25,14,'t');                           # 耳窝阴影
  } elsif ($t eq 'small') {
    for my $y (13..15) { set_px($g,7,$y,'E'); set_px($g,24,$y,'E'); }
    set_px($g,7,14,'t'); set_px($g,24,14,'t');
  }
}

sub draw_race {
  my ($race) = @_;
  my $cfg = $CFG{$race};
  my $pal = $RACE_PAL{$race};
  my ($fx0, $fx1) = ($cfg->{face_x0}, $cfg->{face_x1});
  my $g = make_grid();

  render_hair($g, $cfg, $pal);

  # ---- 脸（16px 脸颊 + 4 级圆润下颌渐收；宽下颌种族加宽 1px/侧）----
  for my $y (8..23) { span_fill($g, $fx0, $fx1, $y, 's'); }
  span_fill($g, $fx0+1, $fx1-1, 24, 's');
  span_fill($g, $fx0+2, $fx1-2, 25, 's');
  span_fill($g, $fx0+4, $fx1-4, 26, 's');
  span_fill($g, $fx0+5, $fx1-5, 27, 's');

  render_ears($g, $cfg);

  # ---- 颈 ----
  span_fill($g, 12, 19, 28, 'S');
  span_fill($g, 12, 19, 29, 's');
  span_fill($g, 12, 19, 30, 's');
  if ($race eq 'dragonborn') { set_px($g,14,29,'c'); set_px($g,17,29,'c'); }

  render_body($g, $cfg, $pal);

  # ---- 面部光影（统一左上光源）----
  span_fill($g, 11, 15, 8, 'T');
  for my $y (9..24) {
    set_px($g, $fx1-1, $y, 'S');
    set_px($g, $fx1, $y, 'D') if $y >= 10 && $y <= 22;
  }
  if ($race eq 'half-orc') { for my $y (10..11) { set_px($g,8,$y,'S'); set_px($g,9,$y,'S'); } }
  set_px($g,$fx0+1,14,'S'); set_px($g,$fx0+1,15,'S');
  set_px($g,$fx1-2,17,'S'); set_px($g,$fx1-1,17,'S');
  span_fill($g, 18, 20, 25, 'S'); set_px($g, 17, 26, 'S');

  # ---- 前层发（贴面发丝/鬓角/刘海，面部填色后重绘）----
  render_hair_front($g, $cfg);

  # ---- 描边 ----
  my $g2 = auto_outline($g);

  # ---- 眉 ----
  if    ($cfg->{brows} eq 'slim')  { span_fill($g2,10,12,9,'d'); span_fill($g2,19,21,9,'d'); }
  elsif ($cfg->{brows} eq 'thick') { span_fill($g2,9,13,9,'d');  span_fill($g2,18,22,9,'d');
                                     span_fill($g2,10,13,10,'d'); span_fill($g2,18,21,10,'d'); }
  elsif ($cfg->{brows} eq 'ridge') { span_fill($g2,9,13,9,'d');  span_fill($g2,18,22,9,'d');
                                     set_px($g2,10,10,'S'); set_px($g2,11,10,'S'); set_px($g2,20,10,'S'); set_px($g2,21,10,'S'); }
  else                             { span_fill($g2,9,13,9,'d');  span_fill($g2,18,22,9,'d');
                                     set_px($g2,10,10,'S'); set_px($g2,11,10,'S'); set_px($g2,12,10,'S');
                                     set_px($g2,19,10,'S'); set_px($g2,20,10,'S'); set_px($g2,21,10,'S'); }

  # ---- 眼（v1.2 可读性重构：4px 宽 × 3 行高；上睑深框线 + 外眼角框 + 虹膜/瞳孔分离；
  #      内眼角留眼白不做闭合框，避免「眼镜」误读）----
  # 左眼 x10-13 / 右眼 x18-21；上睑深框线 ey-1，睁眼 ey~ey+1，下睑阴影带 ey+2
  my $ey = $cfg->{eyes} eq 'low' ? 12 : 11;
  span_fill($g2,10,13,$ey-1,'o'); span_fill($g2,18,21,$ey-1,'o');          # 上睑深框线（与眉 ≥2 级分离）
  for my $s ([10],[18]) {
    my $lx = $s->[0];
    set_px($g2,$lx,$ey,'e');     set_px($g2,$lx+1,$ey,'e');   set_px($g2,$lx+2,$ey,'e');   set_px($g2,$lx+3,$ey,'o');
    set_px($g2,$lx,$ey+1,'i');   set_px($g2,$lx+1,$ey+1,'i'); set_px($g2,$lx+2,$ey+1,'p'); set_px($g2,$lx+3,$ey+1,'o');
    set_px($g2,$lx+1,$ey,'k');                                             # 高光（瞳孔上方，眼白行内）
  }
  if ($cfg->{eyes} eq 'low' && $race eq 'half-orc') {                      # 半兽人红瞳：全红虹膜面
    for my $s ([10],[18]) {
      my $lx = $s->[0];
      set_px($g2,$lx,$ey,'i');
    }
  }
  span_fill($g2,10,13,$ey+2,'S'); span_fill($g2,18,21,$ey+2,'S');          # 下睑阴影带

  # ---- 鼻 ----
  if ($cfg->{nose} eq 'broad') {
    set_px($g2,15,14,'n'); set_px($g2,14,14,'S'); set_px($g2,17,14,'S');  # 鼻根+两侧锚点
    set_px($g2,15,15,'T'); set_px($g2,16,15,'n');
    set_px($g2,15,16,'T'); set_px($g2,16,16,'n');
    span_fill($g2,14,17,17,'n');
    set_px($g2,14,18,'D'); set_px($g2,17,18,'D');                          # 鼻翼外角深影
    set_px($g2,15,18,'S'); set_px($g2,16,18,'S');
  } elsif ($cfg->{nose} eq 'snout') {
    span_fill($g2,15,16,14,'n');                                          # 鼻根
    set_px($g2,14,15,'S'); set_px($g2,14,16,'S'); set_px($g2,14,17,'S');  # 左侧转折（受光侧较浅）
    set_px($g2,17,15,'D'); set_px($g2,17,16,'D'); set_px($g2,17,17,'D');  # 右侧转折深影（圆柱背光侧）
    set_px($g2,15,15,'T'); set_px($g2,16,15,'T');                         # 吻顶受光
    set_px($g2,15,16,'T'); set_px($g2,16,16,'n');                         # 鼻梁中央亮脊（左亮右收）
    set_px($g2,15,17,'n'); set_px($g2,16,17,'n');
    span_fill($g2,13,18,18,'n');                                          # 鼻翼外扩
    set_px($g2,13,18,'S'); set_px($g2,18,18,'S');                         # 翼缘侧收（左浅右深随光源）
    set_px($g2,14,18,'D'); set_px($g2,17,18,'D');                         # 深鼻孔
    set_px($g2,15,18,'n'); set_px($g2,16,18,'n');                         # 鼻尖（柱面受光，与鼻孔拉开）
    span_fill($g2,13,18,19,'n');
    set_px($g2,13,19,'S'); set_px($g2,15,19,'n'); set_px($g2,16,19,'n'); set_px($g2,18,19,'S');
    set_px($g2,14,19,'D'); set_px($g2,17,19,'D');                         # 鼻孔深影下延
    set_px($g2,13,20,'S'); set_px($g2,18,20,'D');                         # 翼底阴影左浅右深（层次拉开）
    span_fill($g2,14,17,20,'S');                                          # 翼底过渡
  } else {
    set_px($g2,15,14,'n'); set_px($g2,14,14,'S'); set_px($g2,17,14,'S');  # 鼻根+两侧锚点
    set_px($g2,15,15,'T'); set_px($g2,16,15,'n');
    set_px($g2,15,16,'T'); set_px($g2,16,16,'n');
    span_fill($g2,14,17,17,'n');
    set_px($g2,14,18,'D'); set_px($g2,17,18,'D');                          # 鼻翼外角深影
    span_fill($g2,15,16,18,'S');
  }

  # ---- 嘴 ----
  if ($cfg->{mouth} eq 'snout') {
    span_fill($g2,13,18,21,'m');                                          # 上唇受光面（中央亮）
    set_px($g2,15,21,'L'); set_px($g2,16,21,'L');                         # 上唇中央亮脊（柱面正对光源）
    set_px($g2,12,21,'M'); set_px($g2,19,21,'M');                         # 唇角深收
    set_px($g2,11,22,'D'); span_fill($g2,12,19,22,'M'); set_px($g2,20,22,'D');  # 口缝线两端深压（吻面转折）
    span_fill($g2,13,18,23,'L');                                          # 下唇亮带（下翻受光）
    set_px($g2,12,23,'M'); set_px($g2,19,23,'M');                         # 下唇两侧收暗
    set_px($g2,13,24,'S'); set_px($g2,18,24,'D');                         # 唇下阴影左浅右深（随光源）
    span_fill($g2,14,17,24,'D');                                          # 唇下深影（与亮下唇拉开层次）
  } elsif ($cfg->{mouth} eq 'tusks') {
    set_px($g2,12,20,'M'); span_fill($g2,13,18,20,'m'); set_px($g2,19,20,'M');
    set_px($g2,12,21,'M'); span_fill($g2,13,18,21,'L'); set_px($g2,19,21,'M');
    span_fill($g2,13,18,22,'S');
  } else {
    set_px($g2,12,20,'M'); span_fill($g2,13,18,20,'m'); set_px($g2,19,20,'M');
    set_px($g2,12,21,'M'); span_fill($g2,13,18,21,'L'); set_px($g2,19,21,'M');
    span_fill($g2,13,18,22,'S');
    span_fill($g2,14,17,23,'D');                                           # 唇颏沟深影
  }
  span_fill($g2,15,16,25,'T') unless $race eq 'dragonborn';

  # ---- 种族专属叠加 ----
  if ($cfg->{mouth} eq 'tusks') {
    set_px($g2,12,22,'w'); set_px($g2,12,23,'w');                        # 左獠牙（2px 高，嘴角上挑）
    set_px($g2,19,22,'w'); set_px($g2,19,23,'w');                        # 右獠牙
    set_px($g2,12,24,'S'); set_px($g2,19,24,'S');                        # 獠牙基座阴影
  }
  if ($cfg->{blush}) {
    set_px($g2,10,17,'r'); set_px($g2,21,17,'r');
  }
  if ($race eq 'dragonborn') {
    set_px($g2,11,17,'c'); set_px($g2,20,17,'c');
    set_px($g2,12,20,'c'); set_px($g2,19,20,'c');
    set_px($g2,13,25,'c'); set_px($g2,18,25,'c');
    set_px($g2,13,12,'C'); set_px($g2,18,12,'C');
  }
  if ($race eq 'dwarf') {
    for my $y (20..23) { span_fill($g2,9,22,$y,'f'); }                     # 络腮胡
    span_fill($g2,10,21,24,'f'); span_fill($g2,10,21,25,'f');
    span_fill($g2,12,19,26,'f'); span_fill($g2,13,18,27,'f');
    span_fill($g2,14,17,28,'f');
    set_px($g2,13,21,'m'); span_fill($g2,14,17,21,'m'); set_px($g2,18,21,'m');  # 胡须中的嘴
    span_fill($g2,13,14,20,'f'); set_px($g2,12,20,'f');                    # 髭
    span_fill($g2,17,18,20,'f'); set_px($g2,19,20,'f');
    for my $p ([11,22],[12,23],[14,24],[17,23],[19,22],[15,26]) { set_px($g2,$p->[0],$p->[1],'F'); }  # 胡须高光
    for my $p ([10,22],[16,24],[20,23],[14,27]) { set_px($g2,$p->[0],$p->[1],'d'); }                   # 胡须暗部
    span_fill($g2,13,18,23,'S');                                           # 唇下阴影压回
    span_fill($g2,14,17,25,'T');
  }

  return ($g2, $pal);
}

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

my %NAMES = (
  'elf'=>'精灵', 'dwarf'=>'矮人', 'halfling'=>'半身人', 'half-orc'=>'半兽人',
  'dragonborn'=>'龙裔', 'gnome'=>'侏儒', 'half-elf'=>'半精灵',
);

print "========== 7 种族基准像 v1.1 生成（人类男性定稿已单独入库）==========\n";
my $fail = 0;
for my $race (sort keys %CFG) {
  eval {
    my ($grid, $pal) = draw_race($race);
    my $asym = symmetry_check($grid);
    my ($svg, $count) = grid_to_svg($grid, $pal);
    die "对称性失败（不对称=$asym > 2）" if $asym > 2;
    die "像素量异常（$count < 600）" if $count < 600;
    my $file = "$OUT/portrait-$race-v1.1.svg";
    open my $fh, '>', $file or die "无法写入 $file: $!";
    print $fh $svg;
    close $fh;
    printf "  OK: %s (%s) — %d px, 不对称=%d, %d B\n", $NAMES{$race}, $race, $count, $asym, -s $file;
    1;
  } or do {
    printf "  FAIL: %s (%s) — %s", $NAMES{$race}, $race, $@;
    $fail++;
  };
}
printf "========== 完成：%d/7 ==========\n", 7 - $fail;
exit($fail ? 1 : 0);
