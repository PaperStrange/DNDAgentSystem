# S2-1 老板终选记录与定稿说明 v1.0

日期：2026-09-01
分支：S2-1-hua ｜ 身份：Hua <hua@dndagent.bot>

## 1. 老板终选结论

8 对象全部选定 **wan 档（v2，wan2.7-image 生成）**。终选理由（老板原话）：
「这一档生效效果很统一且都是正脸」。

| 对象 | 终选源文件 |
|---|---|
| 人类 | human-male-v2-wan.png |
| 精灵 | elf-v2-wan.png |
| 矮人 | dwarf-v2-wan.png |
| 半身人 | halfling-v2-wan.png |
| 半兽人 | half-orc-v2-wan.png |
| 龙裔 | dragonborn-v2-wan.png |
| 侏儒 | gnome-v2-wan.png |
| 半精灵 | half-elf-v2-wan.png |

## 2. 定稿前处置：生成式 UI 元素去除

双审观察项曾登记：wan 档带生成式 UI 边框/文字，终选命中需裁除或重生成。
处置方式裁定为**纯裁切**（不重生成），理由：保留老板拍板认可的构图/色调/正脸形态，零风格漂移风险。

逐张实况与裁切参数（基于实际看图，裁切窗口为占 2048 边长比例）：

| 对象 | 原图 UI 实况 | 裁切（上/下/左/右） | 复验结论 |
|---|---|---|---|
| 人类 | 顶栏 ADVENTURER/LV28 文字+图标、底栏 HP/MP/DEF 状态条、深蓝边框 | 12/12/6/6 | 文字图标全除，正脸居中 ✓ |
| 精灵 | 四角符文角标（无文字） | 首裁 5/5/5/5 残留角标 → 二次 10/10/10/10 | 角标全除，仅余背景淡噪点 ✓ |
| 矮人 | 四角装饰 + 底角黄色字符（K P / 4 5） | 6/12/6/6 | 全除 ✓ |
| 半身人 | 四角图标（罗盘/盾/金币/卷轴）+ 底部像素条 | 7/9/7/7 | 全除 ✓ |
| 半兽人 | 顶 CHARACTER SELECT 文字+盾图标、底 01/HP:847 文字 | 12/12/6/6 | 全除 ✓ |
| 龙裔 | 底部状态栏 DRAGONBORN WARRIOR/HP 247、边框 | 6/13/5/5 | 全除 ✓ |
| 侏儒 | 胸下 GNOME WIZARD 文字+星标、金色边框 | 6/22/6/6 | 全除 ✓ |
| 半精灵 | 金框+四角图标+底部 HALF-ELF 横幅文字 | 首裁 6/16/6/6 残留角标 → 二次 13/20/10/10 | 全除 ✓ |

所有裁切后做正方形居中收边，统一缩放至 1024×1024（NEAREST 保像素锐利）。

## 3. 定稿文件清单（入库件，命名符合 .gitignore 放行规则）

位于 `output/`，8 张，均为 1024×1024：

- human-male-baseline-final.png
- elf-baseline-final.png
- dwarf-baseline-final.png
- halfling-baseline-final.png
- half-orc-baseline-final.png
- dragonborn-baseline-final.png
- gnome-baseline-final.png
- half-elf-baseline-final.png

注：S3-1 旧基准 `portrait-*-baseline-final.png` 8 张为 Sprint 1 产物，与本次定稿并存不冲突；
本次定稿为 S2-1 视觉重做后的新基准，接入后由 John 渲染侧决定旧档去留。

## 4. 验收链后续（老板新增硬条件）

1. John 渲染接入：定稿接入捏脸/冒险界面，预览放大与实战场景无模糊变形
2. Kelly 冒险界面实测（展示一致性）
3. 待确认事项：老板提出 2.5D 多动作头像需求（人物移动/不同动作展示不同头部形态），
   由 John（渲染链路）与 Bob（架构影响评估）确认后，Hua 按需补充多形态头像

## 5. 合规登记

- 候选图（24 张）仍留本地不入库（红线-3），仅定稿 8 张入库
- 密钥全程未回显、未写入任何提交/日志；.env 在 .gitignore 覆盖内
- 裁切脚本（staging-crop.py / staging-crop2.py）与中间件留在 output/（忽略区），不入库
