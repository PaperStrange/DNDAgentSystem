#!/bin/bash
# 8 种族基准像 SVG 生成器（纯 bash，无需 Node.js）
# 画布 32x40, SCALE=12, 输出 384x480 SVG
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/output"
mkdir -p "$OUT"

W=32; H=40; S=12
BG="#1c1824"

# 颜色查找：返回 hex 色值
color() {
  case "$1" in
    o) echo "#2a1a1a";; s) echo "#e8b183";; S) echo "#c17d55";; T) echo "#f7d3a8";;
    h) echo "#5b3a24";; H) echo "#8a5a33";; d) echo "#4a2f1d";;
    e) echo "#f5efe6";; i) echo "#4a6b8a";; p) echo "#241812";; k) echo "#ffffff";;
    n) echo "#b06a45";; m) echo "#b35a50";; M) echo "#8a3f38";;
    E) echo "#d9a077";; t) echo "#b97a50";; u) echo "#3a5a8c";; U) echo "#5a7aac";;
    f) echo "#8a4a22";; F) echo "#b06a32";; w) echo "#e8e0d0";;
    r) echo "#e09888";; b) echo "#3a5828";;
    c) echo "#587868";; C) echo "#88a898";;
    *) echo "UNKNOWN:$1" >&2; echo "#ff00ff";;
  esac
}

# 从行数组生成 SVG
# 参数：$1=输出文件名, $2-$41=40行字符串(每行32字符)
gen_svg() {
  local outfile="$1"; shift
  local rows=("$@")
  local rects=""
  local count=0
  for ((y=0; y<H; y++)); do
    local row="${rows[$y]}"
    for ((x=0; x<W; x++)); do
      local ch="${row:$x:1}"
      if [[ "$ch" != "." ]]; then
        local fill
        fill=$(color "$ch")
        rects+="$(printf '<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>' $((x*S)) $((y*S)) $S $S "$fill")"
        rects+=$'\n'
        ((count++))
      fi
    done
  done
  local vw=$((W*S)) vh=$((H*S))
  cat > "$outfile" <<SVGEOF
<svg xmlns="http://www.w3.org/2000/svg" width="$vw" height="$vh" viewBox="0 0 $vw $vh" shape-rendering="crispEdges">
<rect width="100%" height="100%" fill="$BG"/>
${rects}</svg>
SVGEOF
  echo "  OK: $(basename "$outfile") ($count pixels)"
}

# 自动描边：在已填充像素与空白之间插入 'o'
# 输入/输出：40行字符串数组（通过全局变量 GRID_IN / GRID_OUT 传递）
auto_outline() {
  GRID_OUT=()
  # 先复制到 GRID_OUT
  for ((y=0; y<H; y++)); do
    GRID_OUT+=("${GRID_IN[$y]}")
  done
  # 扫描并添加描边
  for ((y=0; y<H; y++)); do
    local newrow=""
    for ((x=0; x<W; x++)); do
      local ch="${GRID_OUT[$y]:$x:1}"
      if [[ "$ch" == "." ]]; then
        # 检查四邻域
        local has_filled=0
        if ((x > 0)); then
          local l="${GRID_IN[$y]:$((x-1)):1}"
          [[ "$l" != "." ]] && has_filled=1
        fi
        if ((x < W-1)); then
          local r="${GRID_IN[$y]:$((x+1)):1}"
          [[ "$r" != "." ]] && has_filled=1
        fi
        if ((y > 0)); then
          local u="${GRID_IN[$((y-1))]:$x:1}"
          [[ "$u" != "." ]] && has_filled=1
        fi
        if ((y < H-1)); then
          local d="${GRID_IN[$((y+1))]:$x:1}"
          [[ "$d" != "." ]] && has_filled=1
        fi
        if ((has_filled)); then
          newrow+="o"
        else
          newrow+="."
        fi
      else
        newrow+="$ch"
      fi
    done
    GRID_OUT[$y]="$newrow"
  done
}

# 工具：在 GRID_OUT 上设置像素（不覆盖已有非 '.' 像素）
px_set() {
  local x=$1 y=$2 ch=$3
  local row="${GRID_OUT[$y]}"
  local existing="${row:$x:1}"
  if [[ "$existing" == "." || "$existing" == "o" ]]; then
    GRID_OUT[$y]="${row:0:$x}${ch}${row:$((x+1))}"
  fi
}

# 工具：在 GRID_OUT 上强制设置像素
px_force() {
  local x=$1 y=$2 ch=$3
  local row="${GRID_OUT[$y]}"
  GRID_OUT[$y]="${row:0:$x}${ch}${row:$((x+1))}"
}

# 工具：水平填充
span_set() {
  local x0=$1 x1=$2 y=$3 ch=$4
  for ((x=x0; x<=x1; x++)); do px_set $x $y "$ch"; done
}

span_force() {
  local x0=$1 x1=$2 y=$3 ch=$4
  for ((x=x0; x<=x1; x++)); do px_force $x $y "$ch"; done
}

# 工具：矩形填充
rect_set() {
  local x0=$1 y0=$2 x1=$3 y1=$4 ch=$5
  for ((y=y0; y<=y1; y++)); do span_set $x0 $x1 $y "$ch"; done
}

# ============================================================
# 1. 人类男性
# ============================================================
gen_human_male() {
  GRID_IN=(
    "................................"  # 0
    "................................"  # 1
    "............hhhhhhhh............"  # 2
    "..........hhhhhhhhhhhH.........."  # 3
    "........hhhhhhhhhhhhhhhH........"  # 4
    "........hhhhhhhhhhhhhhhh........"  # 5
    "........hhhhhhhhhhhhhhhh........"  # 6
    "........hhhhhhhhhhhhhhhh........"  # 7
    "........hhhhsssssssshhhh........"  # 8
    "........hssssssssssssshh........"  # 9
    "........hssddddssddddssh........"  # 10
    "........hsssssssssssssss........"  # 11
    "........hsssssssssssssss........"  # 12
    "........hsssssssssssssss........"  # 13
    "........hsssssssssssssss........"  # 14
    "........hssssTTTnsssssss........"  # 15
    "........hssssTTTnsssssss........"  # 16
    "........hssssTTTnsssssss........"  # 17
    "........hsssnnnnnsssssss........"  # 18
    "........hsssn..nssssssss........"  # 19
    "........hsssSSnsssssssss........"  # 20
    "........hssmmmmmmsssssss........"  # 21
    "........hssMmmmmMsssssss........"  # 22
    "........hsssSSSSssssssss........"  # 23
    "........hsssTTssssssssss........"  # 24
    "........hssSSSSsssssssss........"  # 25
    "........hssSSSSsssssssss........"  # 26
    "........hsssSSsssssssss........."  # 27
    "........hsssSSSSSSsssss........."  # 28
    "........hsssssssssssssss........"  # 29
    "........uuUUuuuuuuUUuuu........."  # 30
    ".......uuuuuuuuuuuuuuuuu........"  # 31
    "......uuuuuuuuuuuuuuuuuu........"  # 32
    "......uuuuuuuuuuuuuuuuuu........"  # 33
    "......uuuuuuuuuuuuuuuuuu........"  # 34
    "......uuuuuuuuuuuuuuuuuu........"  # 35
    "......uuuuuuuuuuuuuuuuuu........"  # 36
    "......uuuuuuuuuuuuuuuuuu........"  # 37
    "......uuuuuuuuuuuuuuuuuu........"  # 38
    "......uuuuuuuuuuuuuuuuuu........"  # 39
  )
  auto_outline
  # 眼睛
  px_set 11 11 "e"; px_set 12 11 "k"; px_set 13 11 "e"
  px_set 18 11 "e"; px_set 19 11 "k"; px_set 20 11 "e"
  px_set 11 12 "i"; px_set 12 12 "p"; px_set 13 12 "i"
  px_set 18 12 "i"; px_set 19 12 "p"; px_set 20 12 "i"
  # 耳廓内影
  px_set 7 15 "t"; px_set 24 15 "t"
  gen_svg "$OUT/portrait-human-male-v1.0.svg" "${GRID_OUT[@]}"
}

# ============================================================
# 2. 精灵
# ============================================================
gen_elf() {
  GRID_IN=(
    "................................"  # 0
    "................................"  # 1
    "...........hhhhhhhh............"  # 2
    "..........hhhhhhhhhhH.........."  # 3
    "........hhhhhhhhhhhhhhH........."  # 4
    ".......hhhhhhhhhhhhhhhhh........"  # 5
    ".......hhhhhhhhhhhhhhhhh........"  # 6
    ".......hhhhhhhhhhhhhhhhh........"  # 7
    ".......hhsssssssssssshh........."  # 8
    ".......hsssssssssssssshh........"  # 9
    ".......hssdddssssdddsss........."  # 10
    ".......hssssssssssssssss........"  # 11
    ".......hssssssssssssssss........"  # 12
    ".......hssssssssssssssss........"  # 13
    ".......hssssssssssssssss........"  # 14
    ".......hssssTTTnssssssss........"  # 15
    ".......hssssTTTnssssssss........"  # 16
    ".......hssssTTTnssssssss........"  # 17
    ".......hsssnnnnnssssssss........"  # 18
    ".......hsssn..nsssssssss........"  # 19
    ".......hsssSSnssssssssss........"  # 20
    ".......hssmmmmmmssssssss........"  # 21
    ".......hssMmmmmMssssssss........"  # 22
    ".......hsssSSSSsssssssss........"  # 23
    ".......hsssTTsssssssssss........"  # 24
    ".......hssSSSSssssssssss........"  # 25
    ".......hssSSSSssssssssss........"  # 26
    ".......hsssSSsssssssssss........"  # 27
    ".......hsssSSSSSSsssssss........"  # 28
    ".......hssssssssssssssss........"  # 29
    ".......uuuUUuuuuuuuUUuuu........"  # 30
    "......uuuuuuuuuuuuuuuuuu........"  # 31
    "......uuuuuuuuuuuuuuuuuu........"  # 32
    "......uuuuuuuuuuuuuuuuuu........"  # 33
    "......uuuuuuuuuuuuuuuuuu........"  # 34
    "......uuuuuuuuuuuuuuuuuu........"  # 35
    "......uuuuuuuuuuuuuuuuuu........"  # 36
    "......uuuuuuuuuuuuuuuuuu........"  # 37
    "......uuuuuuuuuuuuuuuuuu........"  # 38
    "......uuuuuuuuuuuuuuuuuu........"  # 39
  )
  # 尖耳 — 在 GRID_IN 上添加
  # 左耳尖
  local row; 
  row="${GRID_IN[11]}"; GRID_IN[11]="${row:0:6}EE${row:8}"
  row="${GRID_IN[12]}"; GRID_IN[12]="${row:0:6}EE${row:8}"
  row="${GRID_IN[13]}"; GRID_IN[13]="${row:0:6}EE${row:8}"
  row="${GRID_IN[14]}"; GRID_IN[14]="${row:0:6}EE${row:8}"
  row="${GRID_IN[15]}"; GRID_IN[15]="${row:0:6}EE${row:8}"
  row="${GRID_IN[16]}"; GRID_IN[16]="${row:0:6}EE${row:8}"
  # 右耳
  row="${GRID_IN[11]}"; GRID_IN[11]="${row:0:24}EE${row:26}"
  row="${GRID_IN[12]}"; GRID_IN[12]="${row:0:24}EE${row:26}"
  row="${GRID_IN[13]}"; GRID_IN[13]="${row:0:24}EE${row:26}"
  row="${GRID_IN[14]}"; GRID_IN[14]="${row:0:24}EE${row:26}"
  row="${GRID_IN[15]}"; GRID_IN[15]="${row:0:24}EE${row:26}"
  row="${GRID_IN[16]}"; GRID_IN[16]="${row:0:24}EE${row:26}"
  # 耳尖延伸（尖的部分用 s 色）
  row="${GRID_IN[10]}"; GRID_IN[10]="${row:0:5}s${row:6}"
  row="${GRID_IN[11]}"; GRID_IN[11]="${row:0:5}s${row:6}"
  row="${GRID_IN[10]}"; GRID_IN[10]="${row:0:26}s${row:27}"
  row="${GRID_IN[11]}"; GRID_IN[11]="${row:0:26}s${row:27}"
  # 更尖的耳尖
  row="${GRID_IN[9]}"; GRID_IN[9]="${row:0:4}s${row:5}"
  row="${GRID_IN[9]}"; GRID_IN[9]="${row:0:27}s${row:28}"

  auto_outline
  # 精灵眼睛（绿色虹膜）
  px_set 11 11 "e"; px_set 12 11 "k"; px_set 13 11 "e"
  px_set 18 11 "e"; px_set 19 11 "k"; px_set 20 11 "e"
  px_set 11 12 "i"; px_set 12 12 "p"; px_set 13 12 "i"
  px_set 18 12 "i"; px_set 19 12 "p"; px_set 20 12 "i"
  # 耳内影
  px_set 6 14 "t"; px_set 25 14 "t"
  gen_svg "$OUT/portrait-elf-v1.0.svg" "${GRID_OUT[@]}"
}

# ============================================================
# 3. 矮人
# ============================================================
gen_dwarf() {
  GRID_IN=(
    "................................"  # 0
    "................................"  # 1
    "................................"  # 2
    "...........ssssssssss..........."  # 3 秃顶
    "..........ssssssssssss.........."  # 4
    "........hhsssssssssshh.........."  # 5 侧发开始
    "........hhsssssssssshh.........."  # 6
    "........hhsssssssssshh.........."  # 7
    "........hhsssssssssshh.........."  # 8
    "........hssssssssssssshh........"  # 9
    "........ssddddddssddddddss......"  # 10 浓眉
    "........ssddddddssddddddss......"  # 11 双层眉
    "........ssssssssssssssssss......"  # 12
    "........ssssssssssssssssss......"  # 13
    "........ssssssssssssssssss......"  # 14
    "........sssTTTTnnnssssssss......"  # 15
    "........sssTTTTnnnssssssss......"  # 16
    "........sssTTTTnnnssssssss......"  # 17
    "........ssnnnnnnnnnsssssss......"  # 18 大鼻子
    "........ssnnnnnnnnnsssssss......"  # 19
    "........ffffffffffffffff........"  # 20 胡须开始
    "........ffffffffffffffff........"  # 21
    "........ffffffffffffffff........"  # 22
    "........ffffffffffffffff........"  # 23
    "........ffffffffffffffff........"  # 24
    ".........ffffffffffffff........."  # 25
    ".........ffffffffffffff........."  # 26
    "..........ffffffffffff.........."  # 27
    "..........ffffmmmmffff.........."  # 28 嘴在胡须中
    "...........ffMMMMff............."  # 29
    "...........ffffff..............."  # 30
    "..........uuUUuuuuUUuu.........."  # 31
    ".........uuuuuuuuuuuuuuu........"  # 32
    "........uuuuuuuuuuuuuuuu........"  # 33
    "........uuuuuuuuuuuuuuuu........"  # 34
    "........uuuuuuuuuuuuuuuu........"  # 35
    "........uuuuuuuuuuuuuuuu........"  # 36
    "........uuuuuuuuuuuuuuuu........"  # 37
    "........uuuuuuuuuuuuuuuu........"  # 38
    "........uuuuuuuuuuuuuuuu........"  # 39
  )
  # 修正行宽度到32字符
  for ((i=0; i<H; i++)); do
    local row="${GRID_IN[$i]}"
    local len=${#row}
    if ((len < W)); then
      for ((j=len; j<W; j++)); do row+="."; done
      GRID_IN[$i]="$row"
    elif ((len > W)); then
      GRID_IN[$i]="${row:0:W}"
    fi
  done
  auto_outline
  # 眼睛
  px_set 11 13 "e"; px_set 12 13 "k"; px_set 13 13 "e"
  px_set 18 13 "e"; px_set 19 13 "k"; px_set 20 13 "e"
  px_set 11 14 "i"; px_set 12 14 "p"; px_set 13 14 "i"
  px_set 18 14 "i"; px_set 19 14 "p"; px_set 20 14 "i"
  # 胡须高光
  px_set 12 24 "F"; px_set 13 24 "F"; px_set 19 25 "F"; px_set 20 25 "F"
  gen_svg "$OUT/portrait-dwarf-v1.0.svg" "${GRID_OUT[@]}"
}

# ============================================================
# 4. 半身人
# ============================================================
gen_halfling() {
  GRID_IN=(
    "................................"  # 0
    "................................"  # 1
    "..........hhhhhhhhhh............"  # 2
    ".........hhhhhhhhhhhhH.........."  # 3
    "........hhhhhhhhhhhhhhH........."  # 4
    "........hhhhhhhhhhhhhhhh........"  # 5
    "........hhhhhhhhhhhhhhhh........"  # 6
    "........hhhhhhhhhhhhhhhh........"  # 7
    "........hhsssssssssshhhh........"  # 8
    "........hssssssssssssshh........"  # 9
    "........hssddddssddddsss........"  # 10
    "........hsssssssssssssss........"  # 11
    "........hsssssssssssssss........"  # 12
    "........hsssssssssssssss........"  # 13
    "........hsssssssssssssss........"  # 14
    "........hssssTTTnssssrrs........"  # 15
    "........hssssTTTnssssrrs........"  # 16
    "........hssssTTTnsssssss........"  # 17
    "........hsssnnnnnsssssss........"  # 18
    "........hsssn..nssssssss........"  # 19
    "........hsssSSnsssssssss........"  # 20
    "........hssmmmmmmsssssss........"  # 21
    "........hssMmmmmMsssssss........"  # 22
    "........hsssSSSSssssssss........"  # 23
    "........hsssTTssssssssss........"  # 24
    "........hssSSSSsssssssss........"  # 25
    "........hssSSSSsssssssss........"  # 26
    "........hsssSSsssssssss........."  # 27
    "........hsssSSSSSSsssss........."  # 28
    "........hsssssssssssssss........"  # 29
    "........uuUUuuuuuuuuUUu........."  # 30
    ".......uuuuuuuuuuuuuuuuu........"  # 31
    "......uuuuuuuuuuuuuuuuuu........"  # 32
    "......uuuuuuuuuuuuuuuuuu........"  # 33
    "......uuuuuuuuuuuuuuuuuu........"  # 34
    "......uuuuuuuuuuuuuuuuuu........"  # 35
    "......uuuuuuuuuuuuuuuuuu........"  # 36
    "......uuuuuuuuuuuuuuuuuu........"  # 37
    "......uuuuuuuuuuuuuuuuuu........"  # 38
    "......uuuuuuuuuuuuuuuuuu........"  # 39
  )
  auto_outline
  px_set 11 11 "e"; px_set 12 11 "k"; px_set 13 11 "e"
  px_set 18 11 "e"; px_set 19 11 "k"; px_set 20 11 "e"
  px_set 11 12 "i"; px_set 12 12 "p"; px_set 13 12 "i"
  px_set 18 12 "i"; px_set 19 12 "p"; px_set 20 12 "i"
  px_set 7 15 "t"; px_set 24 15 "t"
  gen_svg "$OUT/portrait-halfling-v1.0.svg" "${GRID_OUT[@]}"
}

# ============================================================
# 5. 半兽人
# ============================================================
gen_half_orc() {
  GRID_IN=(
    "................................"  # 0
    "................................"  # 1
    "................................"  # 2
    "...........hhhhhhhh............."  # 3
    "..........hhhhhhhhhhH..........."  # 4
    "........hhhhhhhhhhhhhh.........."  # 5
    "........hhhhhhhhhhhhhh.........."  # 6
    "........hhhhsssssssshh.........."  # 7
    "........hssssssssssssshh........"  # 8
    "........ssbbbbbbssbbbbbbss......"  # 9 眉脊
    "........ssssssssssssssssss......"  # 10
    "........ssssssssssssssssss......"  # 11
    "........ssssssssssssssssss......"  # 12
    "........ssssssssssssssssss......"  # 13
    "........ssssssssssssssssss......"  # 14
    "........sssssTTTnssssssss......."  # 15
    "........sssssTTTnssssssss......."  # 16
    "........sssssTTTnssssssss......."  # 17
    "........ssssnnnnnssssssss......."  # 18
    "........ssssn..nsssssssss......."  # 19
    "........sssssSnsssssssss........" # 20
    "........ssssssssssssssss........"  # 21
    "........sssMmmmmMsssssss........"  # 22
    "........ssssSSSSssssssss........"  # 23
    "........ssssSSSSssssssss........"  # 24
    "........sssSSSSsssssssss........"  # 25
    "........sssSSSSsssssssss........"  # 26
    "........ssssSSssssssssss........"  # 27
    "........ssssSSSSSSssssss........"  # 28
    "........ssssssssssssssss........"  # 29
    "........uuUUuuuuuuuuUUu........."  # 30
    ".......uuuuuuuuuuuuuuuuu........"  # 31
    "......uuuuuuuuuuuuuuuuuu........"  # 32
    "......uuuuuuuuuuuuuuuuuu........"  # 33
    "......uuuuuuuuuuuuuuuuuu........"  # 34
    "......uuuuuuuuuuuuuuuuuu........"  # 35
    "......uuuuuuuuuuuuuuuuuu........"  # 36
    "......uuuuuuuuuuuuuuuuuu........"  # 37
    "......uuuuuuuuuuuuuuuuuu........"  # 38
    "......uuuuuuuuuuuuuuuuuu........"  # 39
  )
  # 修正宽度
  for ((i=0; i<H; i++)); do
    local row="${GRID_IN[$i]}"
    local len=${#row}
    if ((len < W)); then
      for ((j=len; j<W; j++)); do row+="."; done
      GRID_IN[$i]="$row"
    elif ((len > W)); then
      GRID_IN[$i]="${row:0:W}"
    fi
  done
  # 微尖耳
  local row
  row="${GRID_IN[13]}"; GRID_IN[13]="${row:0:6}EE${row:8}"
  row="${GRID_IN[14]}"; GRID_IN[14]="${row:0:6}EE${row:8}"
  row="${GRID_IN[15]}"; GRID_IN[15]="${row:0:6}EE${row:8}"
  row="${GRID_IN[13]}"; GRID_IN[13]="${row:0:24}EE${row:26}"
  row="${GRID_IN[14]}"; GRID_IN[14]="${row:0:24}EE${row:26}"
  row="${GRID_IN[15]}"; GRID_IN[15]="${row:0:24}EE${row:26}"
  # 耳尖
  row="${GRID_IN[12]}"; GRID_IN[12]="${row:0:5}E${row:6}"
  row="${GRID_IN[12]}"; GRID_IN[12]="${row:0:26}E${row:27}"

  auto_outline
  # 红色眼睛
  px_set 11 12 "e"; px_set 12 12 "k"; px_set 13 12 "e"
  px_set 18 12 "e"; px_set 19 12 "k"; px_set 20 12 "e"
  px_set 11 13 "i"; px_set 12 13 "p"; px_set 13 13 "i"
  px_set 18 13 "i"; px_set 19 13 "p"; px_set 20 13 "i"
  # 獠牙
  px_force 13 24 "w"; px_force 13 25 "w"
  px_force 18 24 "w"; px_force 18 25 "w"
  gen_svg "$OUT/portrait-half-orc-v1.0.svg" "${GRID_OUT[@]}"
}

# ============================================================
# 6. 龙裔
# ============================================================
gen_dragonborn() {
  GRID_IN=(
    "................................"  # 0
    "................................"  # 1
    ".........ssscscscscss..........."  # 2 鳞片头顶
    "........ssscscscscscss.........."  # 3
    "........ssssssssssssss.........."  # 4
    "........ssCscscscsCsss.........."  # 5 鳞片高光
    "........ssscscscscscss.........."  # 6
    "........ssssssssssssss.........."  # 7
    "........ssssssssssssss.........."  # 8
    "........ddddddssddddddss........"  # 9 眉脊
    "........ssssssssssssssss........"  # 10
    "........ssssssssssssssss........"  # 11
    "........ssssssssssssssss........"  # 12
    "........ssssssssssssssss........"  # 13
    "........sssssssssssscss........."  # 14 面部鳞片
    "........ssssTTTnnssssscs........"  # 15
    "........ssssTTTnnsssssss........"  # 16
    "........ssssTTTnnsssssss........"  # 17
    "........sssnnnnnnsssssss........"  # 18 吻部
    "........sssnnnnnnsssssss........"  # 19
    "........sssSSnnSSsssssss........"  # 20
    "........ssssssssssssssss........"  # 21
    "........sssMmmmmMsssssss........"  # 22
    "........ssssSSSSssssssss........"  # 23
    "........ssssSSSSssssssss........"  # 24
    "........sssSSSSsssssssss........"  # 25
    "........sssSSSSsssssssss........"  # 26
    "........ssssSSssssssssss........"  # 27
    "........ssssSSSSSSssssss........"  # 28
    "........ssscscscscscss.........."  # 29 颈部鳞片
    "........uuUUuuuuuuuuUUu........."  # 30
    ".......uuuuuuuuuuuuuuuuu........"  # 31
    "......uuuuuuuuuuuuuuuuuu........"  # 32
    "......uuuuuuuuuuuuuuuuuu........"  # 33
    "......uuuuuuuuuuuuuuuuuu........"  # 34
    "......uuuuuuuuuuuuuuuuuu........"  # 35
    "......uuuuuuuuuuuuuuuuuu........"  # 36
    "......uuuuuuuuuuuuuuuuuu........"  # 37
    "......uuuuuuuuuuuuuuuuuu........"  # 38
    "......uuuuuuuuuuuuuuuuuu........"  # 39
  )
  # 修正宽度
  for ((i=0; i<H; i++)); do
    local row="${GRID_IN[$i]}"
    local len=${#row}
    if ((len < W)); then
      for ((j=len; j<W; j++)); do row+="."; done
      GRID_IN[$i]="$row"
    elif ((len > W)); then
      GRID_IN[$i]="${row:0:W}"
    fi
  done
  # 小耳
  local row
  row="${GRID_IN[13]}"; GRID_IN[13]="${row:0:7}E${row:8}"
  row="${GRID_IN[14]}"; GRID_IN[14]="${row:0:7}E${row:8}"
  row="${GRID_IN[13]}"; GRID_IN[13]="${row:0:24}E${row:25}"
  row="${GRID_IN[14]}"; GRID_IN[14]="${row:0:24}E${row:25}"

  auto_outline
  # 金色眼睛
  px_set 11 11 "e"; px_set 12 11 "k"; px_set 13 11 "e"
  px_set 18 11 "e"; px_set 19 11 "k"; px_set 20 11 "e"
  px_set 11 12 "i"; px_set 12 12 "p"; px_set 13 12 "i"
  px_set 18 12 "i"; px_set 19 12 "p"; px_set 20 12 "i"
  gen_svg "$OUT/portrait-dragonborn-v1.0.svg" "${GRID_OUT[@]}"
}

# ============================================================
# 7. 侏儒
# ============================================================
gen_gnome() {
  GRID_IN=(
    "................................"  # 0
    "................................"  # 1
    ".........hhhhhhhhhhhh..........."  # 2
    "........hhhhhhhhhhhhhhH........."  # 3
    ".......hhhhhhhhhhhhhhhhH........"  # 4
    ".......hhhhhhhhhhhhhhhhh........"  # 5
    "........hhhhhhhhhhhhhhhh........"  # 6
    "........hhhhhhhhhhhhhhhh........"  # 7
    "........hhsssssssssshhhh........"  # 8
    "........hssssssssssssshh........"  # 9
    "........hssdddssssdddsss........"  # 10
    "........hsssssssssssssss........"  # 11
    "........hsssssssssssssss........"  # 12
    "........hsssssssssssssss........"  # 13
    "........hsssssssssssssss........"  # 14
    "........hssssTTTnssrrsss........"  # 15
    "........hssssTTTnssrrsss........"  # 16
    "........hssssTTTnsssssss........"  # 17
    "........hsssnnnnnsssssss........"  # 18
    "........hsssn..nssssssss........"  # 19
    "........hsssSSnsssssssss........"  # 20
    "........hssmmmmmmsssssss........"  # 21
    "........hssMmmmmMsssssss........"  # 22
    "........hsssSSSSssssssss........"  # 23
    "........hsssTTssssssssss........"  # 24
    "........hssSSSSsssssssss........"  # 25
    "........hssSSSSsssssssss........"  # 26
    "........hsssSSsssssssss........."  # 27
    "........hsssSSSSSSsssss........."  # 28
    "........hsssssssssssssss........"  # 29
    "........uuUUuuuuuuuuUUu........."  # 30
    ".......uuuuuuuuuuuuuuuuu........"  # 31
    "......uuuuuuuuuuuuuuuuuu........"  # 32
    "......uuuuuuuuuuuuuuuuuu........"  # 33
    "......uuuuuuuuuuuuuuuuuu........"  # 34
    "......uuuuuuuuuuuuuuuuuu........"  # 35
    "......uuuuuuuuuuuuuuuuuu........"  # 36
    "......uuuuuuuuuuuuuuuuuu........"  # 37
    "......uuuuuuuuuuuuuuuuuu........"  # 38
    "......uuuuuuuuuuuuuuuuuu........"  # 39
  )
  auto_outline
  # 大眼（4px 宽）
  px_set 10 11 "e"; px_set 11 11 "k"; px_set 12 11 "e"; px_set 13 11 "e"
  px_set 10 12 "i"; px_set 11 12 "p"; px_set 12 12 "i"; px_set 13 12 "i"
  px_set 18 11 "e"; px_set 19 11 "e"; px_set 20 11 "k"; px_set 21 11 "e"
  px_set 18 12 "i"; px_set 19 12 "i"; px_set 20 12 "p"; px_set 21 12 "i"
  px_set 7 15 "t"; px_set 24 15 "t"
  gen_svg "$OUT/portrait-gnome-v1.0.svg" "${GRID_OUT[@]}"
}

# ============================================================
# 8. 半精灵
# ============================================================
gen_half_elf() {
  GRID_IN=(
    "................................"  # 0
    "................................"  # 1
    "...........hhhhhhhh............."  # 2
    "..........hhhhhhhhhhH..........."  # 3
    "........hhhhhhhhhhhhhhH........."  # 4
    "........hhhhhhhhhhhhhhhh........"  # 5
    "........hhhhhhhhhhhhhhhh........"  # 6
    "........hhhhhhhhhhhhhhhh........"  # 7
    "........hhsssssssssshhhh........"  # 8
    "........hssssssssssssshh........"  # 9
    "........hssddddssddddsss........"  # 10
    "........hsssssssssssssss........"  # 11
    "........hsssssssssssssss........"  # 12
    "........hsssssssssssssss........"  # 13
    "........hsssssssssssssss........"  # 14
    "........hssssTTTnsssssss........"  # 15
    "........hssssTTTnsssssss........"  # 16
    "........hssssTTTnsssssss........"  # 17
    "........hsssnnnnnsssssss........"  # 18
    "........hsssn..nssssssss........"  # 19
    "........hsssSSnsssssssss........"  # 20
    "........hssmmmmmmsssssss........"  # 21
    "........hssMmmmmMsssssss........"  # 22
    "........hsssSSSSssssssss........"  # 23
    "........hsssTTssssssssss........"  # 24
    "........hssSSSSsssssssss........"  # 25
    "........hssSSSSsssssssss........"  # 26
    "........hsssSSsssssssss........."  # 27
    "........hsssSSSSSSsssss........."  # 28
    "........hsssssssssssssss........"  # 29
    "........uuUUuuuuuuuuUUu........."  # 30
    ".......uuuuuuuuuuuuuuuuu........"  # 31
    "......uuuuuuuuuuuuuuuuuu........"  # 32
    "......uuuuuuuuuuuuuuuuuu........"  # 33
    "......uuuuuuuuuuuuuuuuuu........"  # 34
    "......uuuuuuuuuuuuuuuuuu........"  # 35
    "......uuuuuuuuuuuuuuuuuu........"  # 36
    "......uuuuuuuuuuuuuuuuuu........"  # 37
    "......uuuuuuuuuuuuuuuuuu........"  # 38
    "......uuuuuuuuuuuuuuuuuu........"  # 39
  )
  # 微尖耳
  local row
  row="${GRID_IN[13]}"; GRID_IN[13]="${row:0:6}EE${row:8}"
  row="${GRID_IN[14]}"; GRID_IN[14]="${row:0:6}EE${row:8}"
  row="${GRID_IN[15]}"; GRID_IN[15]="${row:0:6}EE${row:8}"
  row="${GRID_IN[13]}"; GRID_IN[13]="${row:0:24}EE${row:26}"
  row="${GRID_IN[14]}"; GRID_IN[14]="${row:0:24}EE${row:26}"
  row="${GRID_IN[15]}"; GRID_IN[15]="${row:0:24}EE${row:26}"
  # 微尖（比精灵短）
  row="${GRID_IN[12]}"; GRID_IN[12]="${row:0:5}s${row:6}"
  row="${GRID_IN[12]}"; GRID_IN[12]="${row:0:26}s${row:27}"

  auto_outline
  px_set 11 11 "e"; px_set 12 11 "k"; px_set 13 11 "e"
  px_set 18 11 "e"; px_set 19 11 "k"; px_set 20 11 "e"
  px_set 11 12 "i"; px_set 12 12 "p"; px_set 13 12 "i"
  px_set 18 12 "i"; px_set 19 12 "p"; px_set 20 12 "i"
  px_set 6 14 "t"; px_set 25 14 "t"
  gen_svg "$OUT/portrait-half-elf-v1.0.svg" "${GRID_OUT[@]}"
}

# ============================================================
# 主流程
# ============================================================
echo "========== 8 种族基准像 SVG 生成 =========="
echo ""

gen_human_male
gen_elf
gen_dwarf
gen_halfling
gen_half_orc
gen_dragonborn
gen_gnome
gen_half_elf

echo ""
echo "========== 生成完成 =========="
echo "输出目录: $OUT"
ls -la "$OUT"/*.svg 2>/dev/null | wc -l
echo "个 SVG 文件已生成"
