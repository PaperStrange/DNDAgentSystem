# S2-1 候选图生成计划与提示词矩阵 v1.1

状态：**执行中（出图链路已通：百炼 API Key 已落盘 .env，2026-08-31 连通测试图成功）**
依据：老板裁定「图像生成 skill 多模型、每对象 ≥3 候选 → 双审 → 老板终选」；老板 08-31 锁定**风格方向 A 精修像素风**（新增验收硬条件：实际游戏冒险界面可正常展示，32×40 档一眼可读）；参考清单 references-v2.0.md

## 1. 候选矩阵（方向 A 锁定：多模型交叉 × 每对象 ≥3 候选）

对象：human-male / elf / dwarf / halfling / half-orc / dragonborn / gnome / half-elf

| 候选位 | 模型 | 差异化维度 |
|---|---|---|
| v1 | qwen-image-2.0-pro | 基准构图（正面半身、暗灰背景） |
| v2 | wan2.7-image | 冷色蓝灰背景 + 角色选择界面气质 |
| v3 | qwen-image-2.0-pro | 暖色火光背景 + 微侧身构图 + 抖动阴影细节 |

命名：`{race}-v{1,2,3}-{qwen|wan}.png`；候选图留 worktree 本地 output/candidates/，不入库（红线-3 第5条）。
方向锁定前的旧三风格产物（厚涂/卡通档）已归档至 output/candidates/style-superseded/，不参与终选。

## 2. 提示词结构（特征层 + 风格层分离）

特征层（来自 references-v2.0.md 种族考据，逐对象替换）：
- human-male：标准五官、短须、冒险者皮甲装束
- elf：尖耳轮廓线清晰、贴面垂发、修长面部
- dwarf：秃顶+络腮胡占面部下半、宽脸
- halfling：卷发、圆脸、腮红感
- half-orc：下颚双獠牙、粗眉、平头短发
- dragonborn：吻部圆柱光影、错落鳞簇（禁规整网格）、琥珀瞳
- gnome：蓬发、大眼、圆鼻
- half-elf：微尖耳、人类面部基底+精灵发感

风格层（方向 A，三档变体）：
- v1：`pixel art style portrait, crisp readable pixel rendering, front-facing bust, character creation screen, clear readable eyes with white highlight, dark background, game sprite upscale aesthetic`
- v2：`refined pixel art style portrait, crisp readable pixel blocks, front-facing bust, cool blue-slate background, character select screen, clear readable eyes with white highlight, limited vivid color palette, game sprite upscale aesthetic`
- v3：`polished pixel art style portrait, crisp readable pixel blocks, bust with subtle three-quarter turn, warm torch-lit amber background tones, character creation screen, clear readable eyes with white highlight, rich dithered shading within pixel blocks, game sprite upscale aesthetic`

## 3. 执行链

1. 批量驱动脚本仅调度百炼 skill 自带脚本（text_to_image.py / wanx_generate.py），不手写 API 调用
2. 每完成一个种族即提交一次清单更新（小步提交防崩溃丢进度）
3. 自审基于实际看图（附证据）：双眼一眼可读 / 种族第一特征可指认 / 剪影完整 / 32×40 缩略档可读性预判 / 冒险界面展示预判
4. 全部完成后提请双审（Kevin 设计侧 + Bob 技术侧）→ 老板终选单张 → John 渲染接入 → Kelly 冒险界面实测

## 4. 阻断登记（已解除）

| 链路 | 状态 |
|---|---|
| 内置图像生成 | ❌ 上游 400 未修复（本批次不依赖） |
| 百炼图像创作（qwen-image-2.0-pro / wan2.7-image） | ✅ 密钥已由老板落盘项目根 .env（.gitignore 第29行覆盖，零入库风险），连通测试图成功 |
| Seedream 4.5 | ❌ 无 ARK_API_KEY（本批次不依赖） |

## 5. 凭据安全承诺

密钥仅用于百炼出图调用；不回显、不写入任何提交/提审材料/日志；出图完成后老板可要求删除本地密钥文件。
