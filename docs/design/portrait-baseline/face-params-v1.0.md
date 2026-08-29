# 捏脸五维参数范围定义 v1.0

> 作者：Hua（设计 Owner）| 版本：1.0 | 日期：2026-08-29
> 配套文档：portrait-spec-v1.0.md、race-features-v1.0.md
> 画布：32×40 像素，12x 缩放
> 状态：设计冻结

---

## 总览

捏脸系统在 32×40 高分辨率下提供 5 个造型维度的自定义。每个维度的参数变化通过**像素级变换规则**定义，确保设计→代码零转译损耗。

| 维度 | 选项数 | 影响区域 | Y 范围 |
|---|---|---|---|
| 发型 | 8 种 | 头顶 + 鬓角 | y=2-18 |
| 胡须 | 5 种 | 下巴 + 嘴周 | y=19-31 |
| 眉型 | 4 种 | 眉眼带 | y=10-11 |
| 唇部 | 3 种 | 口部 | y=21-23 |
| 纹饰 | 4 种 | 额/颊/颏 | y=9, 17, 24 |

---

## 一、发型（8 种）

发型变换替换头顶区域（y=2-8）和鬓角区域（y=8-18 两侧）的像素。

### 参数定义

| ID | 名称 | 头顶 y=2-4 | 主体 y=5-8 | 鬓角 y=9-18 | 特殊像素 |
|---|---|---|---|---|---|
| 0 | 默认 | x=12-19 | x=8-23 | x=9-10/21-22, y=8-12 | 无 |
| 1 | 长发 | x=11-20 | x=7-24 | x=7-8/23-24, y=8-18 | 两侧延伸至 y=18 |
| 2 | 发髻 | x=13-18, y=0-1 加高 + x=11-20 y=2-4 | x=8-23 | x=9-10/21-22, y=8-12 | 顶部圆髻 2px |
| 3 | 短发/光头 | 无头发像素 | 无 | 无 | 全部露出肤色 s |
| 4 | 马尾 | x=12-19 | x=8-23 | 右侧 x=22-23, y=8-16 竖线 | 右侧 2px 竖线 |
| 5 | 双辫 | x=11-20 | x=7-24 | 两侧 x=7-8/23-24, y=8-20 | 两侧延伸至 y=20 |
| 6 | 蓬松 | x=10-21 | x=6-25 | x=7-8/23-24, y=8-14 | 外扩 2px |
| 7 | 背头 | x=12-19, y=2-3 后移 | x=9-22, y=4-8 | x=9-10/21-22, y=8-10 | 额头 y=8-9 露出 s |

### 像素变换规则

```javascript
// 发型变换伪代码（John 实现参考）
function applyHairStyle(grid, style, hairBase, hairHighlight) {
  // 1. 清除头发区域（y=0-8 全部设为 '.'，鬓角区 y=9-20 两侧清除）
  clearRegion(grid, 0, 0, 31, 8);
  clearRegion(grid, 7, 9, 8, 20);  // 左侧
  clearRegion(grid, 23, 9, 24, 20); // 右侧

  // 2. 按 style ID 绘制新头发
  switch(style) {
    case 0: /* 默认 */ drawDefaultHair(grid, hairBase, hairHighlight); break;
    case 1: /* 长发 */ drawLongHair(grid, hairBase, hairHighlight); break;
    // ... 其余 6 种
  }

  // 3. 重新计算受影响区域的描边
  recalcOutline(grid, 0, 0, 31, 20);
}
```

### 种族适配

| 种族 | 默认可用 | 限制 |
|---|---|---|
| 人类 | 全部 8 种 | 无 |
| 精灵 | 0,1,4,5,6,7 | 无发髻/光头（文化不符） |
| 矮人 | 0,3,6,7 | 秃顶倾向，长发/马尾不可用 |
| 半身人 | 0,1,5,6 | 偏好蓬松/卷发 |
| 半兽人 | 0,3,7 | 偏好短发 |
| 龙裔 | 3 | 默认无发（鳞片头顶） |
| 侏儒 | 0,1,5,6 | 偏好蓬松 |
| 半精灵 | 0,1,4,5,6,7 | 同精灵 |

---

## 二、胡须（5 种）

胡须变换在下巴区域（y=19-31）添加胡须色像素。

### 参数定义

| ID | 名称 | 覆盖区域 | 像素范围 | 适合种族 |
|---|---|---|---|---|
| 0 | 无 | — | 不添加 | 通用 |
| 1 | 短须 | y=24-26, x=13-18 | 3 行 × 6 列 = 18px | 人类/半精灵 |
| 2 | 长须 | y=24-31, x=12-19 渐窄 | 8 行，梯形 ≈ 56px | 矮人经典 |
| 3 | 络腮 | y=19-28, x=8-23 + 连接 | 10 行 × 16 列 ≈ 120px | 半兽人/野蛮人 |
| 4 | 山羊胡 | y=24-27, x=14-17 渐窄 | 4 行，菱形 ≈ 12px | 优雅/法师 |

### 像素变换规则

```javascript
function applyBeard(grid, style, beardColor, beardHighlight) {
  // 清除胡须区域
  clearRegion(grid, 8, 19, 23, 31);
  // 重绘该区域的皮肤
  redrawSkin(grid, 8, 19, 23, 31);

  if (style === 0) return; // 无胡须

  switch(style) {
    case 1: // 短须
      rectFill(grid, 13, 24, 18, 26, beardColor);
      break;
    case 2: // 长须
      rectFill(grid, 12, 24, 19, 27, beardColor);
      rectFill(grid, 12, 28, 19, 29, beardColor);
      rectFill(grid, 13, 30, 18, 31, beardColor);
      set_px(grid, 12, 24, beardHighlight); // 高光
      break;
    case 3: // 络腮
      rectFill(grid, 8, 19, 23, 25, beardColor);
      rectFill(grid, 9, 26, 22, 28, beardColor);
      rectFill(grid, 11, 28, 20, 29, beardColor);
      break;
    case 4: // 山羊胡
      rectFill(grid, 14, 24, 17, 25, beardColor);
      rectFill(grid, 15, 26, 16, 27, beardColor);
      break;
  }
  recalcOutline(grid, 8, 19, 23, 31);
}
```

---

## 三、眉型（4 种）

眉型变换修改 y=10 行的像素。

### 参数定义

| ID | 名称 | y=10 像素变化 | 视觉效果 | 像素数变化 |
|---|---|---|---|---|
| 0 | 标准 | 不修改（保持种族基准） | 正常眉 | 0 |
| 1 | 粗眉 | 左眉 x=9-14 + 右眉 x=17-22 填充 browColor | 加宽 1px 向下至 y=11 两侧 | +8px |
| 2 | 细眉 | 左眉 x=11-12 + 右眉 x=19-20 仅保留 2px | 纤细优雅 | -4px |
| 3 | 伤疤眉 | 左眉保持 + 右眉 x=19 替换为 accentColor | 右眉一道疤痕 | 0（替换） |

### 像素变换规则

```javascript
function applyBrow(grid, style, browColor, accentColor) {
  // 清除眉区
  clearRow(grid, 10, 9, 22);
  clearRow(grid, 11, 9, 10); // 粗眉扩展区
  clearRow(grid, 11, 21, 22);

  switch(style) {
    case 0: // 标准
      spanFill(grid, 10, 13, 10, browColor);
      spanFill(grid, 18, 21, 10, browColor);
      break;
    case 1: // 粗眉
      spanFill(grid, 9, 14, 10, browColor);
      spanFill(grid, 17, 22, 10, browColor);
      set_px(grid, 9, 11, browColor); set_px(grid, 10, 11, browColor);
      set_px(grid, 21, 11, browColor); set_px(grid, 22, 11, browColor);
      break;
    case 2: // 细眉
      spanFill(grid, 11, 12, 10, browColor);
      spanFill(grid, 19, 20, 10, browColor);
      break;
    case 3: // 伤疤眉
      spanFill(grid, 10, 13, 10, browColor);
      spanFill(grid, 18, 21, 10, browColor);
      set_px(grid, 19, 10, accentColor); // 疤痕
      break;
  }
}
```

---

## 四、唇部（3 种）

唇部变换修改 y=21-23 区域的像素。

### 参数定义

| ID | 名称 | y=21-23 像素变化 | 视觉效果 |
|---|---|---|---|
| 0 | 默认 | 不修改（保持种族基准） | 中性表情 |
| 1 | 微笑 | y=21: x=13-18 唇色; y=22: 嘴角上提 — set(x=13,21) 和 set(x=18,21) 改为 skinBase | 嘴角上扬 1px |
| 2 | 严肃 | y=21: x=13-18 唇色; y=22: 嘴角下拉 — set(x=13,22) 和 set(x=18,22) 改为 lipDark | 嘴角平直/微垂 |

### 像素变换规则

```javascript
function applyMouth(grid, style, lipColor, lipDark, skinBase) {
  // 清除嘴区
  clearRegion(grid, 13, 21, 18, 23);

  switch(style) {
    case 0: // 默认
      spanFill(grid, 13, 18, 21, lipColor);
      set_px(grid, 13, 22, lipDark);
      spanFill(grid, 14, 17, 22, lipColor);
      set_px(grid, 18, 22, lipDark);
      spanFill(grid, 14, 17, 23, skinShadow);
      break;
    case 1: // 微笑 — 嘴角上提
      spanFill(grid, 14, 17, 21, lipColor);
      set_px(grid, 13, 21, skinBase); // 左嘴角上提
      set_px(grid, 18, 21, skinBase); // 右嘴角上提
      set_px(grid, 13, 22, lipColor);
      spanFill(grid, 14, 17, 22, lipColor);
      set_px(grid, 18, 22, lipColor);
      spanFill(grid, 14, 17, 23, skinShadow);
      break;
    case 2: // 严肃 — 嘴角平直
      spanFill(grid, 13, 18, 21, lipColor);
      set_px(grid, 13, 22, lipDark);
      spanFill(grid, 14, 17, 22, lipColor);
      set_px(grid, 18, 22, lipDark);
      // 无 y=23 阴影（紧贴）
      break;
  }
}
```

---

## 五、纹饰（4 种）

面部纹饰在特定位置添加装饰色像素（使用饰色 accentColor）。

### 参数定义

| ID | 名称 | 位置 | 像素坐标 | 视觉描述 |
|---|---|---|---|---|
| 0 | 无 | — | 不添加 | 素面 |
| 1 | 额纹 | 额头中央 | (15,9), (16,9), (15,8) — 3px | 额部装饰线 |
| 2 | 颊纹 | 双颊 | (9,17), (10,17), (21,17), (22,17) — 4px | 部落/民族纹面 |
| 3 | 颏纹 | 下巴 | (15,25), (16,25), (15,26) — 3px | 下巴装饰 |

### 像素变换规则

```javascript
function applyMarking(grid, style, accentColor) {
  // 先清除所有纹饰位置
  const positions = [[15,9],[16,9],[15,8], [9,17],[10,17],[21,17],[22,17], [15,25],[16,25],[15,26]];
  for (const [x,y] of positions) clear_px(grid, x, y);

  if (style === 0) return;

  switch(style) {
    case 1: // 额纹
      set_px(grid, 15, 9, accentColor);
      set_px(grid, 16, 9, accentColor);
      set_px(grid, 15, 8, accentColor);
      break;
    case 2: // 颊纹
      set_px(grid, 9, 17, accentColor);
      set_px(grid, 10, 17, accentColor);
      set_px(grid, 21, 17, accentColor);
      set_px(grid, 22, 17, accentColor);
      break;
    case 3: // 颏纹
      set_px(grid, 15, 25, accentColor);
      set_px(grid, 16, 25, accentColor);
      set_px(grid, 15, 26, accentColor);
      break;
  }
}
```

---

## 六、组合约束

### 6.1 互斥规则

| 组合 | 约束 | 原因 |
|---|---|---|
| 光头(3) + 任何发型 | 互斥 | 光头即无发 |
| 龙裔 + 非光头发型 | 互斥 | 龙裔无发 |
| 矮人 + 长发(1) | 互斥 | 文化不符 |
| 络腮(3) + 长须(2) | 互斥 | 胡须区域重叠 |
| 精灵 + 络腮(3) | 不推荐 | 文化不符（不强制禁止） |

### 6.2 组合总数

| 维度 | 选项 | 有效组合（考虑种族限制） |
|---|---|---|
| 发型 | 8 | 人类 8, 精灵 6, 矮人 4, ... |
| 胡须 | 5 | 通用 5 |
| 眉型 | 4 | 通用 4 |
| 唇部 | 3 | 通用 3 |
| 纹饰 | 4 | 通用 4 |
| **总计** | — | 人类: 8×5×4×3×4 = **1920** 种组合 |

### 6.3 数据结构

```javascript
// look 对象（扩展后）
look = {
  hair: 0-7,     // 8 种发型
  beard: 0-4,    // 5 种胡须
  brow: 0-3,     // 4 种眉型
  mouth: 0-2,    // 3 种唇部
  marking: 0-3,  // 4 种面部纹饰
}
```

---

## 七、验收标准

1. 每种发型在 12x 缩放下轮廓差异明显
2. 胡须与面部融合自然，无悬空像素
3. 眉型变化不影响眼睛可见性
4. 唇部变化在 12x 下可辨识（微笑/严肃有明确表情差异）
5. 纹饰使用饰色 accentColor，与肤色对比度 ≥ 15%
6. 所有组合均不产生渲染错误（无未映射字符、无越界像素）

---

*文档结束。全部 S3-1 设计前置交付物完成，待 Kevin 审核。*
