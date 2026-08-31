# S2-1 老板终选记录与定稿说明 v1.1

日期：2026-09-01
分支：S2-1-hua ｜ 身份：Hua <hua@dndagent.bot>

修订说明：v1.0 采用「纯裁切去 UI」处置；经 Bob 架构裁定（2048×2048 裁切易伤头像主体、
风格一致性优先）与 Kevin 定稿执行令，6 张带生成式 UI 的 wan 档改为**整张重生成**
（同模型同提示词 + 无 UI/无边框/无文字约束，不裁切）。本记录按重生成口径修订。

## 1. 老板终选结论

8 对象全部选定 **wan 档（v2，wan2.7-image 生成）**。终选理由（老板原话）：
「这一档生效效果很统一且都是正脸」。

| 对象 | 终选源文件 | 定稿来源 |
|---|---|---|
| 人类 | human-male-v2-wan.png | 重生成档（candidates/human-male-v2-wan-regen.png） |
| 精灵 | elf-v2-wan.png | 原档直出（无 UI，干净） |
| 矮人 | dwarf-v2-wan.png | 重生成档（candidates/dwarf-v2-wan-regen.png） |
| 半身人 | halfling-v2-wan.png | 原档直出（无 UI，干净） |
| 半兽人 | half-orc-v2-wan.png | 重生成档（candidates/half-orc-v2-wan-regen.png） |
| 龙裔 | dragonborn-v2-wan.png | 重生成档（candidates/dragonborn-v2-wan-regen.png） |
| 侏儒 | gnome-v2-wan.png | 重生成档（candidates/gnome-v2-wan-regen.png） |
| 半精灵 | half-elf-v2-wan.png | 重生成档（candidates/half-elf-v2-wan-regen.png） |

## 2. 定稿前处置：生成式 UI 元素去除（重生成口径）

双审观察项登记：wan 档 6 张带生成式 UI 边框/文字（human/dwarf/half-orc/dragonborn/
gnome/half-elf 的 v2）。处置方式按 Bob 裁定为**整张重生成**（不裁切），约束：
同模型（wan2.7-image）+ 终选同款提示词（方向 A 精修像素风 + 正脸胸像 + 冷色板岩背景）
+ 追加「无 UI、无卡片框、无边框、无文字、无数字、无状态栏、无图标、无水印」约束。

逐张重生成自审（基于实际看图）：

| 对象 | 复验结论 |
|---|---|
| 人类 | 无 UI，正脸，双眼带高光可辨，皮甲肩带特征在位 ✓ |
| 矮人 | 无 UI，光头+多辫浓须（种族第一特征）覆盖下半脸，正脸 ✓ |
| 半兽人 | 无 UI，下颌双獠牙+灰绿皮+尖耳，正脸 ✓ |
| 龙裔 | 无 UI，鳞面+冠刺+琥珀眼（人形正向构图，非侧脸），正脸 ✓ |
| 侏儒 | 无 UI，蓬发+大眼+红晕圆脸，正脸 ✓ |
| 半精灵 | 无 UI，微尖耳+精灵系发质+旅人斗篷，正脸 ✓ |

6 张均为 2048×2048 正方形原图（无 UI 残留可裁），等比缩至 1024×1024（NEAREST 保像素锐利），
与精灵/半身人原档直出件统一规格。风格与原终选档一致（同模型同风格层提示词），无漂移。

## 3. 定稿文件清单（入库件，命名符合 .gitignore 放行规则）

位于 `output/`，8 张，均为 1024×1024：

- human-male-baseline-final.png（v1.1 重生成替换）
- elf-baseline-final.png（v1.0 原档，未变）
- dwarf-baseline-final.png（v1.1 重生成替换）
- halfling-baseline-final.png（v1.0 原档，未变）
- half-orc-baseline-final.png（v1.1 重生成替换）
- dragonborn-baseline-final.png（v1.1 重生成替换）
- gnome-baseline-final.png（v1.1 重生成替换）
- half-elf-baseline-final.png（v1.1 重生成替换）

注：S3-1 旧基准 `portrait-*-baseline-final.png` 8 张为 Sprint 1 产物，与本次定稿并存不冲突；
本次定稿为 S2-1 视觉重做后的新基准，接入后由 John 渲染侧决定旧档去留。

## 4. 验收链后续（老板新增硬条件）

1. John 渲染接入：定稿接入捏脸/冒险界面，预览放大与实战场景无模糊变形
2. Kelly 冒险界面实测（展示一致性）
3. 2.5D 多朝向头像：已闭环——John 渲染侧确认 + Bob 架构裁定：现有 drawSprite 四向机制
   （down 正脸/up 后脑/左右镜像 + bob 动画）已零成本满足老板诉求，分工为
   「展示层正脸立绘 + 游戏内四向像素 sprite」，无需补产朝向图

## 5. 合规登记

- 候选图（24 张）与重生成中间档（6 张 -regen）均留本地不入库（红线-3），仅定稿 8 张入库
- 密钥全程未回显、未写入任何提交/日志；.env 在 .gitignore 覆盖内
- 重生成脚本（batch-regen-noui.sh / regen-log-noui.txt）与裁切旧脚本留在忽略区，不入库
- v1.0 裁切件已被 v1.1 重生成件原地覆盖，无裁切残留进入定稿
