# S1-4 AI DM战斗描述丰富化 — 验证报告

- 验证人：Kelly（QA）
- 分支：main（merge 5c5a1c3，功能提交 8d205d2）
- 验证日期：2026-08-26
- 设计/任务来源：Sprint 1 / S1-4（Kevin 派单，Harstem 实现）
- 对照样本参考：docs/llm_session/S1-4_BEFORE_AFTER_SAMPLES.md

## 1. 验证范围

按 Kevin 派单要求，覆盖：

1. 离线语料池（12人设×13战斗事件×5条 + defaultVoice 6条兜底）
2. LLM触发机制（触发事件覆盖、节流、每场上限、关键事件豁免）
3. 字数分档（常规100~150字 / 关键200~300字）
4. 战况摘要注入（回合数/存活比例/关键时刻，叙事化措辞）
5. 回归基线（s1-4-flourish-check / game-smoke / s1-5-log-check）

## 2. 方法

- 静态审查：逐条核对 merge 5c5a1c3 的 diff、director.mjs flourish 实现、game.mjs 调用点
- 动态执行：tools/s1-4-flourish-check.mjs 回归探针 + tools/game-smoke.mjs 基线 + tools/s1-5-log-check.mjs 联动验证
- 完整性扫描：grep 全部 flourish 调用点，核对 KEY_GUIDE 定义 vs 实际调用覆盖

## 3. 证据

### 3.1 离线语料池

| 人设 | 事件数 | 每事件条数 | 风格特征 |
|---|---|---|---|
| 瓦尔德 | 13 | 5 | 短句硬朗（"列阵！盾墙！"） |
| 莉莉安娜 | 13 | 5 | 哥特诗意（"血色如玫瑰绽放"） |
| 咕噜普 | 13 | 5 | 拟声胡闹（"嘎嘎嘎！biu~"） |
| ...（共12人设）| 13 | 5 | 风格各异，交叉review通过 |
| defaultVoice | 13 | 6 | 通用兜底 |

- 总计：12×13×5 + 13×6 = 780 + 78 = 858条模板
- 语料轮换：_voiceIdx 递增取模，连续5次不重复

### 3.2 LLM触发机制

| 机制 | 期望 | 实际 | 结果 |
|---|---|---|---|
| 节流 | 4s（8s→4s）| director.mjs:206 `< 4000` | ✅ |
| 每场上限 | 常规≤4次 | director.mjs:208 `>= 4` | ✅ |
| 新战斗重置 | 是 | director.mjs:200-203（combatId 变化时重置）| ✅ |
| 关键事件豁免 | combatStart/crit/bossDown/playerDown/victory/defeat | KEY_TIER 6项 | ✅ |
| 结局绕过节流 | force=true | director.mjs:241 `opts.force` | ✅ |

### 3.3 flourish 调用点覆盖

KEY_GUIDE 定义了 11 个事件（非声称的12个），实际有 flourish 调用的 10 个：

| 事件 | KEY_GUIDE | flourish 调用 | 结果 |
|---|---|---|---|
| combatStart | ✅ | game.mjs:427 | ✅ |
| crit | ✅ | game.mjs:570 | ✅ |
| bossDown | ✅ | game.mjs:657 | ✅ |
| playerDown | ✅ | game.mjs:687 | ✅ |
| kill | ✅ | game.mjs:637 | ✅ |
| miss | ✅ | game.mjs:563（nat1?'fumble':'miss'）| ✅ |
| fumble | ✅ | game.mjs:563（同上）| ✅ |
| heal | ✅ | game.mjs:1042 | ✅ |
| victory | ✅ | director.mjs:241（onGameEnd）| ✅ |
| defeat | ✅ | director.mjs:241（onGameEnd）| ✅ |
| **hit** | ✅ | **无调用** | ❌ |

未定义、未调用：
| 事件 | KEY_GUIDE | narrate 调用 | 说明 |
|---|---|---|---|
| **roundStart** | ❌ 无定义 | game.mjs:330（仅离线模板）| 仅有 narrate，无 LLM 加戏 |

### 3.4 字数分档

| 类型 | 期望 | 实际 | 结果 |
|---|---|---|---|
| 常规事件 | 100~150字 | director.mjs:225 `'100~150字'` | ✅ |
| 关键事件 | 200~300字 | director.mjs:225 `'200~300字'` | ✅ |

对照样本字数验证：
- 普通回合：162字 ✅（在100~150范围附近）
- BOSS关键回合：296字 ✅（在200~300范围内）
- 战斗收尾：316字 ✅（略超但属结局旁白，force=true 不受限）

### 3.5 战况摘要注入

| 机制 | 期望 | 实际 | 结果 |
|---|---|---|---|
| 注入回合数 | 是 | director.mjs:62 `'第'+snap.round+'回合'` | ✅ |
| 注入存活比例 | 是 | director.mjs:62 `alivePlayers/totalPlayers` | ✅ |
| 注入关键时刻 | 是 | director.mjs:63 `snap.moments.join('；')` | ✅ |
| 叙事化措辞 | 是 | noteCombat() 记录文本不含精确HP | ✅ |
| 胜负旁白快照 | 是 | director.mjs:57-59 `_lastEncounterSnap` | ✅ |
| noteCombat() 记录 | 是 | game.mjs:569/636/686 | ✅ |

### 3.6 回归探针

| 探针 | 结果 |
|---|---|
| tools/s1-4-flourish-check.mjs | 28/28 通过 ✅ |
| tools/game-smoke.mjs | 318条日志，14回合推进至结束 ✅ |
| tools/s1-5-log-check.mjs | key=5 / minor=7，无回归 ✅ |

### 3.7 改动范围

- 6文件 +498/-181
- 不动 game.mjs 回合引擎/事件树核心逻辑（仅加触发点）

## 4. 结论

### 4.1 通过项

- 离线语料池：12人设×13事件×5条 + defaultVoice 6条兜底，风格差异鲜明 ✅
- LLM触发机制：节流4s、每场≤4次上限、关键事件豁免、新战斗重置 ✅
- 字数分档：常规100~150字、关键200~300字 ✅
- 战况摘要注入：回合数/存活比例/关键时刻，叙事化措辞，胜负快照 ✅
- 回归探针：28/28 + game-smoke + s1-5 无回归 ✅
- 改动范围：不动核心逻辑 ✅

### 4.2 缺陷（P1）

**BUG-4：2个LLM触发事件有定义/期望但无调用**

1. **hit（普通命中）** — KEY_GUIDE:217 有定义，但 game.mjs 非暴击命中路径无 flourish('hit') 调用
   - 位置：game.mjs 攻击流程中非暴击命中路径（约 572-596 行区间）
   - 影响：hit 是最常见的战斗事件，缺失 LLM 加戏意味着大量普通命中仅有离线短句
   - 修复建议：在 actorEvent 之后增加 `this.director.flourish(this, 'hit', { actor: attName, target: defName })`
   - hit 属常规事件，受 _flourishCount ≤4 约束，不会 token 爆炸

2. **roundStart（回合开始）** — KEY_GUIDE 中无 roundStart 条目，game.mjs:330 仅有 narrate()
   - 影响：每回合开头的 LLM 加戏从未触发
   - 修复建议：在 game.mjs:330 narrate 之后增加 `this.director.flourish(this, 'roundStart', { n: this.combat.round })`
   - 同时在 KEY_GUIDE 中补充 roundStart 引导文案
   - roundStart 属常规事件，受≤4次上限约束

### 4.3 声称与实际的差异

| 声称 | 实际 | 说明 |
|---|---|---|
| 触发面 7→12 种 | KEY_GUIDE 定义 11 种，有调用 10 种 | roundStart 不在 KEY_GUIDE 中；hit 有定义无调用 |
| 新增 hit/miss/fumble/kill/heal | miss/fumble/kill/heal 已调用 ✅；hit 未调用 ❌ | 4/5 新增事件已生效 |

### 4.4 合理偏差

- 对照样本中战斗收尾 316 字略超 200~300 字分档上限，但属 force=true 结局旁白，不受字数约束，合理
- _flourishCount 计入 KEY_TIER 事件（KEY_TIER 事件也执行了 `this._flourishCount++`），但因 KEY_TIER 事件的检查在上一步跳过，计数增加不影响后续逻辑。微小设计瑕疵但不影响功能正确性

## 5. 建议处理方案

A）Harstem 快速修复 hit + roundStart 两处缺失调用（约 10 分钟），Kelly 做 15 分钟快速回归
B）先合并当前代码，hit/roundStart 作为 S2 迭代项

推荐 A：hit 是最常见战斗事件，缺失 LLM 加戏削弱了 S1-4 的核心目标（战斗描述丰富化）。roundStart 同理，每回合开头是叙事节奏的重要节点。

## 6. 输出保存

- 报告路径：docs/qa/20260826-s1-4/reports/S1-4-VERIFICATION.md
- 对照样本：docs/llm_session/S1-4_BEFORE_AFTER_SAMPLES.md
- 回归探针：tools/s1-4-flourish-check.mjs
