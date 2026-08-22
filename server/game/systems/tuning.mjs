// 难度调校系统（F-22/F-32）：AI DM依据规则书调整怪物数值与NPC对话
// - F-22：开局前按队伍人数与等级对全部章节怪物/BOSS调校
// - F-32：每次冒险的AI DM按上一章节玩家表现调整下一章难度；NPC对话变体避免每次游玩雷同
// 纪律：AI输出必须结构校验+数值钳制（严禁随意生成）；离线公式兜底立即可用
import { clamp } from '../../util.mjs';

const round2 = (n) => Math.round(n * 100) / 100;

export function installTuning(game) {
  game.tuning = { chapters: {} }; // chId -> {hpMul, dmgMul, countDelta, source}
  game.npcTexts = {};             // npcId -> {greet, options:{id:text}, results:{id:log}}

  // 当前章节的调校参数（无则1.0）
  game.tuningFor = function (chapterId) {
    return this.tuning.chapters[chapterId || this.chapter?.id] || { hpMul: 1, dmgMul: 1, countDelta: 0 };
  };

  // 平均等级（按存活玩家）
  game.avgLevel = function () {
    const alive = [...this.players.values()].filter(p => !p.dead);
    if (!alive.length) return 1;
    return alive.reduce((a, p) => a + (p.level || 1), 0) / alive.length;
  };

  // 离线公式（规则书对齐：新手套组规则"1级队伍可应付4只哥布林或1只熊地精"——按等级差与上章表现微调，
  // 范围严格受限：HP 0.7~1.25、伤害 0.8~1.15、数量 -1~+1，BOSS只调HP；
  // 队伍低于本章等级上限时只降不升（遭遇难度与队伍等级相称），等级达标且游刃有余才可升难度）
  game.offlineTuningFor = function (chapter, perf = null) {
    const lv = this.avgLevel();
    const cap = chapter.levelUpTo || 1;
    const under = cap - lv;
    let hpMul = 1, dmgMul = 1, countDelta = 0;
    if (under > 0) { hpMul = round2(Math.max(0.8, 1 - under * 0.1)); dmgMul = round2(Math.max(0.85, 1 - under * 0.08)); }
    if (perf && perf.maxHpSum > 0) {
      const strain = perf.damageTaken / perf.maxHpSum;
      if (perf.downs >= 2 || strain >= 0.8) { hpMul = round2(Math.max(0.7, hpMul - 0.15)); dmgMul = round2(Math.max(0.8, dmgMul - 0.1)); }
      else if (under <= 0 && perf.downs === 0 && strain < 0.3 && perf.kills >= 2) {
        hpMul = round2(Math.min(1.25, hpMul + 0.05));
        countDelta = 1;
      }
    }
    return { hpMul, dmgMul, countDelta };
  };

  // 结构校验+钳制（AI输出与离线公式共用；超出规则书允许范围的一律拒绝）
  game._clampTuning = function (t, isBossChapter) {
    if (!t || typeof t !== 'object') return null;
    const hpMul = clamp(Number(t.hpMul) || 1, 0.7, isBossChapter ? 1.15 : 1.25);
    const dmgMul = clamp(Number(t.dmgMul) || 1, 0.8, 1.15);
    const countDelta = isBossChapter ? 0 : clamp(Math.round(Number(t.countDelta) || 0), -1, 1);
    return { hpMul: round2(hpMul), dmgMul: round2(dmgMul), countDelta };
  };

  // 热应用调校到当前章节已生成实体（HP按比例缩放、攻击伤害倍率更新、数量不足时补足）
  game.applyTuningForChapter = function (chapterId) {
    const chId = chapterId || this.chapter?.id;
    if (!chId) return;
    const chDef = this.dungeon.chapters.find(c => c.id === chId);
    const t = this._clampTuning(this.tuning.chapters[chId] || this.offlineTuningFor(chDef, null), !!chDef?.boss);
    this.tuning.chapters[chId] = t;
    if (chId !== this.chapter?.id) return;
    // 现有实体：HP按比例重算
    for (const e of this.entities.values()) {
      if (e.kind !== 'monster') continue;
      const def = e.monDef || e.defKey;
      const base = Math.max(1, Math.round(e.baseHp * t.hpMul));
      const ratio = base / Math.max(1, e.maxHp);
      e.maxHp = base;
      e.hp = Math.max(1, Math.min(base, Math.round(e.hp * ratio)));
      for (const a of e.attacks) a.dmgMul = t.dmgMul;
    }
    // 数量不足：按缺口补刷（不超过本章定义上限）
    const metas = chDef?.monsters || [];
    for (const meta of metas) {
      const target = this._monsterTargetCount(meta, t);
      const cur = [...this.entities.values()].filter(e => e.kind === 'monster' && e.defKey === meta.def && !e.dead).length;
      for (let i = cur; i < target; i++) {
        const pt = this._randomWalkable();
        const e = this._monsterEntity(meta.def, meta, pt.x, pt.y, meta.squad);
        this.entities.set(e.eid, e);
      }
    }
  };

  // 某怪物条目在本章的目标数量（基础缩放+AI调校增量；BOSS固定1只）
  game._monsterTargetCount = function (meta, t) {
    const partySize = Math.max(1, [...this.players.values()].filter(p => !p.dead).length);
    const scaled = partySize < 4 ? Math.max(1, Math.min(meta.count, Math.round(meta.count * partySize / 4))) : meta.count;
    const delta = meta.squad === 'boss' ? 0 : (t?.countDelta || 0);
    return Math.max(1, Math.min(meta.count, scaled + delta));
  };

  // 章节表现追踪（F-32输入）：倒地/受伤/休息/击杀，随章节切换重置
  game._resetChapterPerf = function () {
    this.chapterPerf = { downs: 0, damageTaken: 0, restsUsed: 0, kills: 0, maxHpSum: 0, startedAt: Date.now() };
    const alive = [...this.players.values()].filter(p => !p.dead);
    this.chapterPerf.maxHpSum = alive.reduce((a, p) => a + (this.entities.get(p.eid)?.maxHp || p.sheet?.maxHp || 1), 0);
  };
  game._chapterPerformance = function () {
    const alive = [...this.players.values()].filter(p => !p.dead);
    this.chapterPerf.maxHpSum = alive.reduce((a, p) => a + (this.entities.get(p.eid)?.maxHp || p.sheet?.maxHp || 1), 0);
    return { ...this.chapterPerf };
  };

  // 开局前准备：AI DM调校全章节（离线公式兜底，绝不阻塞开局）+ NPC对话变体
  game.prepareTuning = async function () {
    try {
      const t = await this.director.tuneAdventure(this);
      if (t && typeof t === 'object') {
        for (const ch of this.dungeon.chapters) {
          const raw = t.chapters?.[ch.id];
          const fallback = this.offlineTuningFor(ch, null);
          let clamped = raw ? (this._clampTuning(raw, !!ch.boss) || fallback) : fallback;
          clamped = this._levelGateTuning(ch, clamped, fallback); // 规则书：等级未达标只降不升
          this.tuning.chapters[ch.id] = clamped;
        }
      }
    } catch (e) { /* 离线公式兜底 */ }
    // 确保全章节都有调校
    for (const ch of this.dungeon.chapters) {
      if (!this.tuning.chapters[ch.id]) this.tuning.chapters[ch.id] = this.offlineTuningFor(ch, null);
    }
    try {
      const v = await this.director.npcTextVariants(this);
      if (v && typeof v === 'object') this.npcTexts = v;
    } catch (e) { /* 离线变体 */ }
    this.applyTuningForChapter(this.chapter.id);
    const cur = this.tuningFor(this.chapter.id);
    this.logMsg('system', '⚖️ AI DM 依据规则书完成本次冒险难度调校（队伍Lv' + this.avgLevel().toFixed(1) + '：本章怪物生命×' + cur.hpMul + '、伤害×' + cur.dmgMul + (cur.countDelta ? '、数量' + (cur.countDelta > 0 ? '+' : '') + cur.countDelta : '') + '）。');
    this.onChange();
  };

  // 规则书门控：队伍平均等级低于本章等级上限时，调校只能调低或持平（遭遇难度与队伍等级相称）
  game._levelGateTuning = function (ch, t, fallback) {
    const under = (ch.levelUpTo || 1) - this.avgLevel();
    if (under <= 0) return t;
    return {
      hpMul: round2(Math.min(t.hpMul, fallback.hpMul)),
      dmgMul: round2(Math.min(t.dmgMul, fallback.dmgMul)),
      countDelta: Math.min(t.countDelta, 0),
    };
  };

  // 章节切换：离线公式立即应用下一章，LLM按上章表现异步精调（就绪后热应用）
  game._scheduleChapterAdjust = function (nextIdx, perf) {
    const ch = this.dungeon.chapters[nextIdx];
    const fallback = this.offlineTuningFor(ch, perf);
    this.tuning.chapters[ch.id] = fallback;
    if (this.director.online) {
      Promise.resolve(this.director.tuneChapter(this, ch, perf)).then(t => {
        if (this.closed || !t) return;
        const clamped = this._clampTuning(t, !!ch.boss) || fallback;
        this.tuning.chapters[ch.id] = this._levelGateTuning(ch, clamped, fallback); // 规则书门控
        this.applyTuningForChapter(ch.id);
        this.onChange();
      }).catch(() => {});
    }
  };

  // NPC文本覆盖（对话系统与快照共用）
  game.npcTextOf = function (npcId, field, key, fallback) {
    const v = this.npcTexts?.[npcId];
    if (!v) return fallback;
    if (field === 'greet') return v.greet || fallback;
    if (field === 'option') return v.options?.[key] || fallback;
    if (field === 'result') return v.results?.[key] || fallback;
    return fallback;
  };

  game._resetChapterPerf();
}
