# S1-4 BUG-4 Quick Regression Report

Branch: main (commit 7c01587) | Verifier: Kelly

## BUG-4: 2 Missing LLM Trigger Call Points - Fixed

### Code Review (2 files, +3 lines)

1. **hit (non-crit)** - game.mjs:578 `if (!nat20) this.director.flourish(this, 'hit', { actor: attName, target: defName })` - added after actorEvent, `!nat20` guard prevents duplicate with crit path
2. **roundStart** - game.mjs:331 `this.director.flourish(this, 'roundStart', { n: this.combat.round })` - added after narrate('roundStart')
3. **director.mjs KEY_GUIDE** - roundStart entry added with guidance text (render battle atmosphere progression, no numerical values)

### LLM Trigger Coverage: 12/12

| # | Event | Call Point | Tier |
|---|---|---|---|
| 1 | combatStart | game.mjs:427 | key |
| 2 | miss | game.mjs:563 | regular |
| 3 | fumble | game.mjs:563 | regular |
| 4 | crit | game.mjs:570 | key |
| 5 | hit | game.mjs:578 | regular |
| 6 | kill | game.mjs:637 | regular |
| 7 | bossDown | game.mjs:657 | key |
| 8 | playerDown | game.mjs:687 | key |
| 9 | heal | game.mjs:1042 | regular |
| 10 | roundStart | game.mjs:331 | regular |
| 11 | victory | director.mjs:241 | key |
| 12 | defeat | director.mjs:241 | key |

### Constraint Verification

- hit and roundStart NOT in KEY_TIER (only combatStart/crit/bossDown/playerDown/victory/defeat are key)
- Both subject to `_flourishCount >= 4` per-battle regular limit
- Both subject to 4s throttle (`< 4000` guard)
- `!nat20` guard on hit prevents double-trigger with crit flourish

### Regression Probes

- tools/s1-4-flourish-check.mjs: 28/28 PASS
- tools/s1-5-log-check.mjs: PASS (key=5, minor=7)
- tools/game-smoke.mjs: PASS (319 logs, 14 rounds to defeat)

### Known Issue (Not blocking)

- narrator-probe F-37 rotation assertion FAIL on main baseline (pre-existing, unrelated to BUG-4)

## Conclusion: All pass, S1-4 can be fully closed
