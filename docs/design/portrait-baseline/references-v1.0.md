# S3-1 基准像设计 · 参考素材清单（红线-8 合规附件）

版本：v1.0 ｜ 状态：随 b7645b9 提审附带 ｜ 维护人：Hua <hua@dndagent.bot>
用途：证明「参考先行」已落实——眼部结构/器官轮廓细节参考 + 7 种族特征参考的采集记录与提炼要点。后续地图/BOSS 等设计资产沿用本清单格式。

## 一、人类基准（老板提供，非本次检索）

| 参考 | 来源 | 对应对象 | 提炼要点 |
|---|---|---|---|
| 人类男性像素肖像参考图 | 老板群内提供（本地唯一权威参考） | 人类基准像面部基底 | 每 1-2 行有颜色变化；器官边缘有深色轮廓分隔；4-5 级明度层次 |

## 二、眼部结构与器官轮廓分离（方法论参考）

| # | 来源 | 对应对象 | 提炼要点 |
|---|---|---|---|
| R1 | [从8x8到64x64像素画角色眼睛创作技巧](https://www.163.com/dy/article/L35UE0CG0526K8VB.html) | 眼睛最小可读规格 | 小尺寸下眼睛须「眼白/虹膜/瞳孔+深色上睑线」分层；低于 4×2 像素则退化为色斑；上睑深线是 1x 尺寸下眼睛可读性的第一要素 |
| R2 | [2D pixel art for games: complete style guide](https://www.sprite-ai.art/blog/2d-pixel-art-style-guide) | 器官轮廓分离 | 相邻面部结构间需 ≥2 级明度跳变或 1px 深色轮廓线；同色系单级明度差在小尺寸下会糊成一片 |
| R3 | [Pixel Logic - A Guide to Pixel Art](https://anyflip.com/kdjou/llhc/basic) | 明度阶与可读性 | 可读性优先于细节：先保证剪影与器官级对比，再加纹理；审查须在 1x 实际显示尺寸下进行 |
| R4 | [How to start making pixel art #7. Working with lines](https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-7-e504bfa4ddf2) | 器官级描边规则 | 选择性描边（selective outlining）：仅对需要分离的结构加 1px 深线，避免全闭合框（闭合眼框会被误读为眼镜——本轮盲读实测验证） |
| R5 | [Pixel Art Tutorial - Shading (Kiwinuptuo)](https://m.huaban.com/pins/3591021148/) | 面部光影分阶 | 阴影色相向环境色偏移而非单纯压暗；高光/基色/阴影/深影 4+ 阶是面部立体感的下限 |
| R6 | [用Photoshop轻松绘制可爱的像素风格小角色](https://baijiahao.baidu.com/s?id=1834850442054889391) | 小尺寸五官布点 | 眉/眼/鼻/唇的纵向行距分配：眉眼带与口颏带各留独立行区间，器官间至少隔 1 行过渡 |

## 三、7 种族特征参考

| # | 来源 | 对应对象 | 提炼要点 |
|---|---|---|---|
| R7 | [Pixel art elvin archer sprite](https://m.huaban.com/pins/4817453619/) | 精灵 | 尖耳须超出脸部轮廓线才可辨；长发以「贴面垂落+参差发梢」表现，发丝用断续明暗缕而非连续深线（连续深线误读为头盔纵脊，本轮实测） |
| R8 | [Dwarf Avatars 32x32 Pixel Icon Pack](https://m.blog.csdn.net/2403_88403568/article/details/144980142) | 矮人 | 32px 级头像中矮人辨识=络腮胡占面部下半 40%+；秃顶高光用散点油光而非整块亮区（整块误读为帽子，本轮实测） |
| R9 | [RPG Maker Time Fantasy Add-on: Dwarves Vs Elves](https://store.steampowered.com/app/783506/?l=schinese) | 矮人/精灵并排对比 | 同网格下种族对比靠「头部轮廓剪影差异」：矮人宽方+胡须外扩，精灵窄长+发丝贴面 |
| R10 | [D&D Dragonborn 角色设计参考](https://m.huaban.com/pins/5808124547/) | 龙裔 | 吻部须有前突圆柱光影（中央亮脊+两侧深转折）；鳞片用不规则错落明暗簇，规整网格会误读为织物头饰 |
| R11 | [DDO Wiki - Races](https://ddowiki.com/page/Races) | 8 种族特征考据 | 半兽人獠牙为下颌上突白点；龙裔无发、颅顶鳞甲；侏儒体型特征以大眼+蓬乱发量表达 |
| R12 | [Baldur's Gate 3 Wiki - Races](https://bg3.wiki/wiki/Races) | 8 种族特征考据 | 半精灵=人类基底+微尖耳+精灵发量；半身人圆脸+卷发+腮红是辨识三要素 |
| R13 | [Qwen Pixel Art 实战案例：NPC头像生成](https://blog.csdn.net/weixin_30205153/article/details/159038822) | 头像管线方法 | 头像类资产须同时产出原尺寸与 1x 显示尺寸两版供审；种族特征在 1x 下不可读即判定失败 |

## 四、要点落地对照（参考 → 本轮修改）

- R1 → 眼睛扩为 4×3 五件套（上睑深框线/眼白+高光/虹膜/瞳孔/下睑阴影带），8 种族统一
- R2/R4 → 器官轮廓分离规则写入 portrait-spec-v1.2.md 第三章（≥2 级明度差或 1px 深线；内眼角不闭合）
- R3/R13 → 新增 1x（32×40）尺寸自检与双档样图（12x + 1x）提审制度
- R7/R8/R10 → 精灵发缝改断续明暗缕、矮人秃顶改散点油光、龙裔废弃棋盘格鳞改错落鳞簇+吻部圆柱光影
- R11/R12 → race-features-v1.0.md 各种族第一/第二特征与考据来源对齐
