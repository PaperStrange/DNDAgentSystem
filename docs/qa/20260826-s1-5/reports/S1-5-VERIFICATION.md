# S1-5 战斗日志信息密度优化 — 验证报告

- 验证人：Kelly（QA）
- 分支：main（commit af74db6）
- 验证日期：2026-08-26
- 设计/任务来源：Sprint 1 / S1-5（Kevin 派单，John 实现）

## 1. 验证范围

按 Kevin 派单要求，覆盖：

1. 服务端 imp 标签正确性（key / minor）
2. 前端分层渲染（important / minor CSS 类）
3. 旧日志正则兜底（无 imp 字段时）
4. 回归基线（自动滚动、过滤器、聊天分页、回归探针、game-smoke）

## 2. 方法

- 静态审查：逐条核对 commit af74db6 的 diff 与服务端 logMsg 调用点
- 动态执行：tools/s1-5-log-check.mjs 回归探针 + tools/game-smoke.mjs 基线
- 完整性扫描：grep 服务端所有 logMsg 调用，排查"应标未标"的关键事件

## 3. 证据

### 3.1 回归探针（tools/s1-5-log-check.mjs）

运行输出（节选）：

```
== imp=key (5) ==
  [combat] ━━━ ⚔️ 战斗开始！（突袭：你们未被发现，先发制人！） ━━━
  [combat] ☠️ 哥布林 被击败！
  [combat] 💥 哥布林 受到 99 点物理伤害（重击）（剩余0/5）
  [combat] ☠️ 哥布林 被击败！
  [combat] 💀 B 倒下了！死亡豁免开始计数，需要队友救援
== imp=minor (6) ==
  [dice] 🎲 A 敏捷 13
  [dice] 🎲 B 敏捷 13
  [dice] ⚔️ 哥布林 敏捷 14
  [dice] ⚔️ 哥布林 敏捷 14
  [dice] 🎲 A 用长剑攻击 哥布林：d20=10+5=15 vs AC15（命中！）
  [dice] 🎲 A 用长剑攻击 哥布林：d20=18+5=23 vs AC15（命中！）
S1-5 验证通过
```

退出码 0。

### 3.2 game-smoke 基线

- 引擎推进至结束（defeat），273 条日志无卡死
- 回合引擎正常、先攻顺序正常、死亡豁免路径正常

### 3.3 前端分层渲染（代码审查）

- public/js/screens/game.mjs `highlight()` 改为优先读 `l.imp`：
  - `imp === 'key'` → ' important'（金色加粗+左边框）
  - `imp === 'minor'` → ' minor'（11px 暗色压缩）
  - 无 imp 字段 → 旧正则兜底（BOSS/涅兹纳尔/升级/受到/恢复/金币）
- 自动滚动逻辑（挂载后滚动）未改动
- 过滤器/聊天分页逻辑未改动（仅 filter 条件读取，未涉及 imp）

### 3.4 服务端 imp 标签覆盖（逐条核对）

| 事件 | 期望 | 实际 | 结果 |
|---|---|---|---|
| 暴击攻击骰（nat20）| key | key | ✅ |
| 大失败（nat1）| key | key | ✅ |
| 重击伤害 | key | key（条件） | ✅ |
| 怪物被击杀（含 BOSS 👑）| key | key | ✅ |
| 队友倒地 | key | key | ✅ |
| 阵亡 | key | key | ✅ |
| 死亡豁免失败 | key | key | ✅ |
| 奇迹苏醒（nat20）| key | key | ✅ |
| 战斗开始 | key | key | ✅ |
| 战斗结束 | key | key | ✅ |
| BOSS 暴露开战（stealth.mjs）| key | key | ✅ |
| 普通命中攻击骰 | minor | minor | ✅ |
| 未命中攻击骰（含优劣势）| minor | minor | ✅ |
| 先攻敏捷骰 | minor | minor | ✅ |
| 死亡豁免成功 | minor | minor | ✅ |

### 3.5 应标未标的遗漏点（完整性扫描发现）

| 编号 | 位置 | 事件 | 现象 | 严重度 |
|---|---|---|---|---|
| BUG-3 | game.mjs:671 | 已倒地玩家再受伤 → 死亡豁免自动失败 | 无 imp 标签（与其他死亡豁免失败不一致）| P2 |
| 观察-1 | game.mjs:611 | 非重击伤害日志 | crit=false 时传 `{}` 而非 minor（Kevin 要求"普通伤害压缩降级"）| P3（设计澄清）|
| 观察-2 | game.mjs:329 | 回合分隔符（"━━━ 第N回合 ━━━"）| 无 imp 标签（按 Kevin "roundStart 常规回合 100~150 字" 建议可考虑 minor）| P3（设计澄清）|
| 观察-3 | stealth.mjs:126/131 | BOSS 逃跑掷骰结果 | 无 imp 标签 | P3 |

## 4. 结论

### 4.1 通过项

- 服务端 imp 标签覆盖率：15/15（按 Kevin 明确清单全过）
- 前端分层渲染逻辑正确（imp 优先 + 旧正则兜底）
- 自动滚动、过滤器、聊天分页逻辑未受影响
- tools/s1-5-log-check.mjs 通过，退出码 0
- tools/game-smoke.mjs 通过，273 条日志推进至结束

### 4.2 缺陷（建议 Sprint 内修复）

- **BUG-3（P2）**：已倒地再受伤的死亡豁免失败缺 imp 标签，与其他"死亡豁免失败=key"不一致。建议：
  - 文件：server/game/game.mjs:671
  - 修复：在 logMsg 调用末尾追加 `{ imp: 'key' }`，与第 288 行保持一致

### 4.3 设计澄清项（不阻塞合并，建议 Kevin 与 John 对齐）

- 观察-1：非重击伤害日志是否应降级为 minor？Kevin 任务单未明确，当前实现为"无标签→走旧正则→命中'受到/💥'→dmg 类（粉红色）"。若保持现状，视觉层次仍合理（重击金色 > 普通粉红色 > 未命中暗色）。
- 观察-2/3：回合分隔符、BOSS 逃跑掷骰的 imp 归属可由 Kevin 后续统一裁定。

### 4.4 合理偏差

- John 未对非战斗事件（升级/目标完成/钥匙获得/金币拾取）打 imp 标签，但旧正则兜底仍能将其归入 important/dmg/heal/gold 类，视觉表现不受影响。
- commit message 提到的"BOSS 暴露表决"实际对应 stealth.mjs 的 BOSS 察觉开战日志，命名略有偏差但标签正确。

## 5. 建议处理方案

A）John 快速修复 BUG-3（1 行改动），Kelly 做 10 分钟快速回归
B）BUG-3 与 S1-4 验证一并处理
C）观察-1/2/3 在 Sprint 回顾时统一裁定 imp 归属规范

推荐 A：BUG-3 是明确的标签遗漏，与其他死亡豁免失败路径不一致，应立即修复。

## 6. 输出保存

- 报告路径：docs/qa/20260826-s1-5/reports/S1-5-VERIFICATION.md
- 证据（探针输出）：内联于报告 §3.1
- 证据（game-smoke 输出）：内联于报告 §3.2
- 注：原 qa-outputs/ 路径已按红线-2 清理，产物统一迁移至 docs/qa/
