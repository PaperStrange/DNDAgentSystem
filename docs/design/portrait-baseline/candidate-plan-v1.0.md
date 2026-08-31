# S2-1 候选图生成计划与提示词矩阵 v1.0

状态：**待执行（出图链路阻断中，见「阻断登记」）**
依据：老板裁定「图像生成 skill 多模型、每对象 ≥3 风格候选 → 双审 → 老板终选」；参考清单 references-v2.0.md

## 1. 候选矩阵（8 对象 × 3 风格 = 24 张起）

对象：human-male / elf / dwarf / halfling / half-orc / dragonborn / gnome / half-elf

| 风格 | 说明 | 计划模型 |
|---|---|---|
| A 精修像素风 | 保留游戏内 32×40 可读性，对标「一眼可读」验收 | 内置图像生成 / qwen-image-2.0-pro |
| B 厚涂半写实立绘 | 对标成熟 RPG 立绘质感 | Seedream 4.5 / wan2.7-image |
| C 卡通渲染 | 轻量化备选 | Seedream 4.5 / qwen-image-2.0-pro |

## 2. 提示词骨架（三风格共用特征层，风格层分离）

特征层（来自 references-v2.0.md 种族考据，逐对象替换）：
- human-male：标准五官、短须可选、冒险者装束
- elf：尖耳轮廓线清晰、贴面垂发、修长面部
- dwarf：秃顶+络腮胡占面部下半 40%、宽脸
- halfling：卷发、圆脸、腮红感
- half-orc：下颚双獠牙、粗眉、平头短发
- dragonborn：吻部圆柱光影、错落鳞簇（禁规整网格）、琥珀瞳
- gnome：蓬发、大眼、圆鼻
- half-elf：微尖耳、人类面部基底+精灵发感

风格层：
- A：`pixel art, 32x40 grid proportions, front-facing bust, clear readable eyes with white highlight, character creation screen`
- B：`semi-realistic oil painting portrait, dramatic rim light, RPG character splash art, bust shot`
- C：`cel-shaded anime style, clean lineart, flat color blocks, chibi-free bust portrait`

## 3. 执行链（链路打通后）

1. 每对象每风格出图 1~2 张（不同模型交叉），落 worktree 本地 output/candidates/（不入库，红线-3 第5条）
2. 每完成一个种族即提交一次清单更新（小步提交防崩溃丢进度）
3. 必读要素自检（基于实际看图，附证据）：双眼一眼可读 / 种族第一特征可指认 / 剪影完整
4. 全部完成后提请双审（Kevin 设计侧 + Bob 技术侧）→ 老板终选

## 4. 阻断登记（2026-08-31 深夜）

| 链路 | 状态 | 证据 |
|---|---|---|
| 内置图像生成 | ❌ 上游 400（消息序缺陷，provider_error，request_id e29db90d，复测仍复现） | 本轮重试原样报错 |
| 百炼图像创作（qwen-image / wan2.7） | ❌ 无 DASHSCOPE_API_KEY，环境变量与项目 config 均未配置 | env 核查仅有平台 bridge/job token |
| Seedream 4.5 | ❌ 无 ARK_API_KEY | 同上 |

解除条件（二选一，已向老板申请）：
① 提供百炼 DashScope API Key（bailian.console.aliyun.com，新用户有免费额度）
② 平台修复内置图像生成上游报错
