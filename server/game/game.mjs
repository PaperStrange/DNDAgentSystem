// 游戏状态机：章节/地图/实体/回合/战斗/法术/道具/对话/胜负
import { parseMap, DUNGEONS, MONSTERS, NPCS, ITEMS } from './dungeon.mjs';
import { roll, d20, pick, shuffle, clamp, findPath, losClear, dist, manhattan, uid } from '../util.mjs';
import { ATTR_NAMES } from '../rules/rulesdb.mjs';
import { assignOfflineGoals, offlineVerify } from './hiddengoals.mjs';
import { installEntities } from './entities.mjs';
import { installDialogue } from './systems/dialogue.mjs';
import { installProgress } from './systems/progress.mjs';
import { installStates } from './systems/states.mjs';
import { installStealth } from './systems/stealth.mjs';
import { installCamp } from './systems/camp.mjs';
import { installTuning } from './systems/tuning.mjs';

// 升级经验需求表（按当前等级索引）：显示给玩家的具体数量；章节等级上限仍按 levelUpTo 控制节奏
const XP_NEED = [0, 120, 350, 650];


let SEQ = 1;

import { installTurn } from './systems/turn.mjs';
import { installCombat } from './systems/combat.mjs';
export class Game {
  constructor({ room, sheets, personaId, director, onChange, isPlayerOnline }) {
    this.onChange = onChange || (() => {});
    this.isPlayerOnline = isPlayerOnline || (() => true);
    this.turnTimer = null;
    this.room = room;
    this.personaId = personaId;
    this.dungeon = DUNGEONS.find(d => d.id === room.dungeonId) || DUNGEONS[0];
    this.director = director;
    this.state = 'intro';
    this.speed = 1;      // 战斗速度倍率（玩家可调）
    this.paused = false; // 暂停（冻结怪物计时器）
    this.chapterIdx = 0;
    this.chapter = null;
    this.map = null;
    this.entities = new Map();
    this.combat = { active: false, round: 0, order: [], idx: 0 };
    this.turn = null;
    this.flags = new Set();
    this.log = [];
    this.events = [];
    this.win = null;
    this.startedAt = Date.now();
    this.timers = [];
    this.closed = false;
    this.openedChests = new Set();
    this.searchedProps = new Set();
    this.deadSquads = new Set();
    this.players = new Map();
    this.keys = new Set(); // 队伍共有的剧情钥匙
    this.dialogues = new Map();
    this.xpPool = 0;
    this.clues = []; // 队伍共享线索（任意玩家获得，全队可见）
    this.seatOrder = [...sheets.keys()];
    const soloStartPotion = sheets.size === 1 ? 3 : 1; // B-11：单人开局多带治疗药水，避免1分钟内团灭
    for (const [pid, sheet] of sheets) {
      this.players.set(pid, {
        pid, name: sheet.name, sheet, eid: null, gold: 30, level: Math.max(1, sheet.level || 1), xp: sheet.xp || 0, // 跨冒险继承
        items: { potion: soloStartPotion, flask: 0 }, keys: [],
        slots: sheet.spells?.length ? { 1: 2 } : null,
        charges: {}, blessed: false, mark: null, hiddenThisRound: false, halflingReroll: true,
        deathSaves: { s: 0, f: 0 }, downed: false, stable: false, dead: false,
        stats: { damageDealt: 0, damageTaken: 0, kills: 0, lastHits: 0, goldEarned: 0, healed: 0, spellsCast: 0,
                 npcTalks: 0, talkTags: [], searches: 0, chestsOpened: 0, crits: 0, downedCount: 0, restsUsed: 0,
                 maxMultiHit: 0, rescues: [], initiativeWins: 0, usesHide: 0, bossLastHit: false, attacksMissed: 0 },
        goals: [], claimCooldown: 0,
      });
    }
    // 架构迁移：实体/对话/进度系统以安装器挂载（各系统独立演进，路线见 docs/llm_session/ARCHITECTURE.md）
    installEntities(this);
    installDialogue(this);
    installProgress(this);
    installTuning(this);  // F-22/F-32：先于_loadChapter挂载（怪物工厂读取调校参数）
    installStates(this);  // F-23：玩家/团队状态机
    installStealth(this); // F-29/F-31：视野暴露状态机+怪物游荡+BOSS遭遇表决
    installCamp(this);    // F-30：营地界面（短休改为营地休整）
    installCombat(this);  // S2-5：战斗轮序与攻击结算
    installTurn(this);    // S2-5：回合状态机与玩家动作
    // F-24：事件树（每个玩家单独维护，存储于开房玩家=服务端）；combatEvents为本次战斗总树
    this.combatEvents = [];
    this.eventTrees = new Map(); // pid -> 该玩家的事件树（本次战斗）
    this.combatCount = 0;
    this._loadChapter(0);
  }

  // 队伍共享线索：任意玩家获得后全队可在线索面板查看
  addClue(text) {
    const entry = { seq: SEQ + 1, text, ts: Date.now() };
    this.clues.push(entry);
    if (this.clues.length > 50) this.clues.splice(0, this.clues.length - 50);
    this.logMsg('clue', '🔍 新线索：' + text);
  }

  // F-24：事件树——战斗中的关键事件按(回合,参与者)记录；每名玩家单独维护一份事件树（存储于开房玩家=服务端）

  // 全局序号（日志/事件/事件树共享）：系统模块经此方法取号，保证单调递增不重复
  seqNext() { return SEQ++; }

  // ---------- 日志 ----------
  logMsg(kind, text, extra = {}) {
    this.log.push({ seq: SEQ++, kind, text, ts: Date.now(), ...extra });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }
  event(t, data) {
    this.events.push({ seq: SEQ, t, ts: Date.now(), ...data });
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }
  narrate(key, ctx = {}) {
    const text = this.director.narrate(this, key, ctx);
    this.logMsg('narr', text, { dm: true });
    return text;
  }
  later(ms, fn) {
    const t = setTimeout(() => { if (!this.closed) fn(); }, ms);
    this.timers.push(t);
    return t;
  }

  // ---------- 章节 ----------
  _loadChapter(idx) {
    this.chapterIdx = idx;
    this.chapter = this.dungeon.chapters[idx];
    this.map = parseMap(this.chapter);
    // 地图主题色板：先离线主题立即可用，AI调色板异步就绪后刷新（按剧情生成）
    this.mapTheme = this.chapter.theme || null;
    if (this.director?.chapterTheme) {
      const chRef = this.chapter;
      Promise.resolve(this.director.chapterTheme(chRef)).then(th => {
        if (this.closed || this.chapter !== chRef || !th) return;
        this.mapTheme = th;
        this.onChange();
      }).catch(() => {});
    }
    this.entities = new Map();
    this.combat = { active: false, round: 0, order: [], idx: 0 };
    this.turn = null;
    this.dialogues.clear();
    // 玩家实体
    // F-33：出生点安全筛选——距BOSS≥17格（避免进章即触发BOSS遭遇表决）、距怪物≥视野+2（开局保持「冒险中」不被逼战）
    const rawSpawns = this.map.spawns.length ? this.map.spawns : [{ x: 1, y: 1 }];
    const safeSpawns = rawSpawns.filter(s => {
      for (const ent of this.map.entities) {
        if (ent.kind !== 'monster') continue;
        const def = MONSTERS[ent.def];
        const minDist = def?.boss ? 17 : (def?.vision || 6) + 2;
        if (Math.abs(s.x - ent.x) + Math.abs(s.y - ent.y) < minDist) return false;
      }
      return true;
    });
    const spawns = safeSpawns.length ? safeSpawns : rawSpawns;
    const keepAway = spawns.map(s => ({ x: s.x, y: s.y, r: 8 })); // F-33：补刷怪物远离玩家出生区（≥8格）
    let si = 0;
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const s = spawns[si % spawns.length]; si++;
      const e = this._playerEntity(p, s.x, s.y);
      p.eid = e.eid;
      this.entities.set(e.eid, e);
      p.charges = { dragonbreath: 1, channeldivinity: 1, tactician: 1, huntermark2: 1 };
      p.blessed = false; p.mark = null; p.halflingReroll = true;
      p.deathSaves = { s: 0, f: 0 };
      if (p.downed && !p.dead) { e.hp = Math.max(1, p.sheet.maxHp); p.downed = false; }
    }
    // 章节怪物（B-11：小队不足4人时按比例缩减数量与生命，保证单人可玩；4/5人队维持原样；
    // F-22/F-32：AI DM按规则书调校的数量增量叠加）
    const partySize = Math.max(1, [...this.players.values()].filter(p => !p.dead).length);
    this.partyHpScale = partySize < 4 ? 0.5 + 0.5 * partySize / 4 : 1;
    const tuning = this.tuningFor(this.chapter.id);
    const targetCount = (meta) => this._monsterTargetCount(meta, tuning);
    const placedByDef = new Map();
    for (const ent of this.map.entities) {
      if (ent.kind !== 'monster') continue;
      const meta = (this.chapter.monsters || []).find(m => m.def === ent.def) || { def: ent.def, squad: 'auto' };
      const squadKey = this.chapter.id + ':' + meta.squad;
      if (this.deadSquads.has(squadKey)) continue;
      if (meta.count !== undefined) {
        const placed = placedByDef.get(ent.def)?.length || 0;
        if (placed >= targetCount(meta)) continue;
      }
      const e = this._monsterEntity(meta.def, meta, ent.x, ent.y, meta.squad);
      this.entities.set(e.eid, e);
      if (!placedByDef.has(ent.def)) placedByDef.set(ent.def, []);
      placedByDef.get(ent.def).push(e);
    }
    // 补充不足的怪物数量
    for (const meta of this.chapter.monsters || []) {
      const placed = placedByDef.get(meta.def)?.length || 0;
      const squadKey = this.chapter.id + ':' + meta.squad;
      if (this.deadSquads.has(squadKey)) continue;
      const target = targetCount(meta);
      for (let i = placed; i < target; i++) {
        const pt = this._randomWalkable({ minDistFrom: keepAway }); // F-33：补刷怪物远离玩家出生区
        const e = this._monsterEntity(meta.def, meta, pt.x, pt.y, meta.squad);
        this.entities.set(e.eid, e);
      }
    }
    // NPC
    for (const ent of this.map.entities) {
      if (ent.kind !== 'npc') continue;
      const e = this._npcEntity(ent.def, ent.x, ent.y);
      this.entities.set(e.eid, e);
    }
    // F-30：记录上一个营地（进入带篝火的章节时更新——逃跑传送的落点）
    const campfire = (this.map.props || []).find(pr => pr.type === 'campfire');
    if (campfire) this.lastCamp = { chapterIdx: idx, x: campfire.x, y: campfire.y };
    // 升级检查
    for (const [pid, p] of this.players) {
      const target = this.chapter.levelUpTo || 1;
      if (target > p.level) this._levelUp(p, target);
    }
    // F-24：章节切换时清空上一场战斗的事件树；F-32：重置本章表现统计
    this.combatEvents = [];
    this.eventTrees.clear();
    this._resetChapterPerf();
  }
  // ---------- 回合 ----------
  beginPlay() {
    this.state = 'playing';
    this._startWander(); // F-31：冒险状态下怪物随机游荡（战斗时自动停止）
    this._startFirstTurn();
  }

  // ---------- 战斗 ----------
  // F-25：阵营敏捷比较——先攻顺序构建。同一阵营敏捷高者先动；玩家先动时团队打头，否则敏捷高的一方先动（平局团队先动）


  // ---------- 攻击结算 ----------

  // ---------- 玩家动作 ----------
  getPlayer(pid) { return this.players.get(pid); }
  isPlayerTurn(pid) { return this.turn && this.turn.playerId === pid && this.state === 'playing'; }








  // R-9: 结算评价（LLM一句话评价+评分，离线模板降级）
  async evaluate(pid) {
    const p = this.players.get(pid);
    if (!p || !this.win) return { err: '冒险结束后才能生成评价' };
    const s = p.stats;
    const alive = !p.dead;
    const rating = this._ratePlayer(s, alive);
    let comment = '';
    if (this.director.online) {
      try {
        const summary = this.director._eventSummary(this, p);
        const res = await this.director.chatOnce([
          { role: 'system', content: '你是' + this.director.persona.name + '。' + this.director.persona.systemPrompt },
          { role: 'user', content: '冒险已结束。请为该玩家写一句话评价（30字以内，简体中文，不含评分数值）：角色' + p.name + '（' + p.sheet.raceName + ' ' + p.sheet.className + '），数据摘要：' + summary },
        ]);
        if (res && res.text) comment = res.text.slice(0, 60);
      } catch (e) { /* 降级 */ }
    }
    if (!comment) {
      const templates = ['命运记住了ta的名字。', '篝火旁会有人讲起ta的故事。', '这一路的风霜，都是勋章。', '骰子会想念ta的手气。'];
      const idx = Math.abs([...p.name].reduce((a, c) => a + c.charCodeAt(0), 0)) % templates.length;
      comment = templates[idx];
    }
    return { ok: true, rating, comment, name: p.name };
  }
  _ratePlayer(s, alive) {
    let score = 0;
    score += Math.min(40, Math.round(s.damageDealt / 5));      // 伤害贡献
    score += Math.min(30, s.kills * 6);                        // 击杀
    score += Math.min(20, Math.round(s.healed / 3));           // 治疗
    score += Math.min(10, s.rescues.length * 5);               // 救援
    score += Math.min(10, s.crits * 3);                        // 暴击
    score += alive ? 10 : 0;                                   // 存活
    if (s.bossLastHit) score += 15;
    const rank = score >= 100 ? 'S' : score >= 75 ? 'A' : score >= 50 ? 'B' : score >= 25 ? 'C' : 'D';
    return { rank, score };
  }

  async actClaim(pid) {
    const p = this.players.get(pid);
    if (!p || this.state !== 'playing') return { ok: false, msg: '现在不能宣称目标' };
    const goal = p.goals[0];
    if (!goal) return { ok: false, msg: '你没有隐藏目标' };
    if (goal.status === 'confirmed') return { ok: false, msg: '目标已确认达成' };
    if (p.claimCooldown > 0) return { ok: false, msg: '请稍后再试（冷却中）' };
    p.claimCooldown = 2;
    const alive = !p.dead;
    const result = await this.director.judgeClaim(this, p, goal, alive);
    if (result.ok) {
      goal.status = 'confirmed';
      this.narrate('claimConfirm', { actor: p.name });
      this.logMsg('goal', '🏆 ' + p.name + ' 的隐藏目标「' + goal.name + '」达成！', { private: p.pid });
      this.event('claim', { pid, goalId: goal.id, ok: true });
      // 全员达成？
      const all = [...this.players.values()].every(x => x.goals[0] && x.goals[0].status === 'confirmed');
      if (all) this._endGame('hidden', '所有冒险者都完成了自己的隐藏目标——命运选择了你们！');
    } else {
      goal.status = 'denied';
      this.narrate('claimDeny', { actor: p.name });
      this.logMsg('goal', '❌ ' + p.name + ' 宣称隐藏目标，但DM裁定尚未达成。', { private: p.pid });
      this.event('claim', { pid, goalId: goal.id, ok: false });
    }
    return { ok: true };
  }



  // ---------- 结束 ----------
  _endGame(kind, reason) {
    if (this.state !== 'playing') return;
    this.state = 'ended';
    this._stopWander(); // F-31：冒险结束停止游荡
    this.win = { kind, reason, at: Date.now(), duration: Date.now() - this.startedAt };
    this.logMsg('system', '━━━ 🎉 冒险结束 ━━━');
    // 结算时自动判定隐藏目标（离线机械验证；宣称按钮已移除）
    for (const [pid, p] of this.players) {
      const g2 = p.goals[0];
      if (g2 && g2.status === 'pending') {
        const okRes = offlineVerify(g2, p.stats, !p.dead);
        g2.status = okRes ? 'confirmed' : 'denied';
        this.logMsg('goal', (okRes ? '🏆 ' : '❌ ') + p.name + ' 的隐藏目标「' + g2.name + '」' + (okRes ? '达成' : '未达成') + '（结算判定）', { private: pid });
      }
    }
    if (kind === 'defeat') this.narrate('defeat', {});
    else this.narrate('victory', {});
    this.logMsg('narr', reason, { dm: true });
    this.director.onGameEnd(this, kind);
    this.onChange();
  }

  // 经验达标即升级（不超过本章等级上限，维持既有等级曲线节奏）
  _checkXpLevel() {
    const cap = this.chapter.levelUpTo || 1;
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      while (p.level < cap && p.xp >= (XP_NEED[p.level] || Infinity)) this._levelUp(p, p.level + 1);
    }
  }

  // ---------- 移除玩家（踢出/离房） ----------
  removePlayer(pid, byKick = false) {
    const p = this.players.get(pid);
    if (!p) return;
    const e = this.entities.get(p.eid);
    if (e) e.dead = true;
    if (this.combat.order) {
      const pos = this.combat.order.indexOf(p.eid);
      if (pos >= 0) {
        this.combat.order.splice(pos, 1);
        if (this.combat.idx > pos) this.combat.idx--;
      }
    }
    if (byKick) this.narrate('kick', { actor: p.name });
    else this.logMsg('system', '🚪 ' + p.name + ' 离开了冒险');
    if (this.camp?.active && this.camp.ownerPid === pid) { this.camp.active = false; this.camp.ownerPid = null; this.setTeamState('adventuring'); } // F-30：营地休整者离场
    this.players.delete(pid);
    this.seatOrder = this.seatOrder.filter(x => x !== pid);
    this.dialogues.delete(pid);
    this.eventTrees.delete(pid); // F-24：离场玩家事件树移除
    if (this.pendingBoss) this.pendingBoss.votes.delete(pid); // F-30：离场者不再参与表决
    if (this.turn && this.turn.playerId === pid) { this.turn = null; this._endTurn(); }
    if (this.state === 'playing' && this.players.size === 0) this._endGame('defeat', '没有玩家了');
    if (this.state === 'playing') this._checkTpk();
    this.onChange();
  }

  alivePlayerCount() {
    return [...this.players.values()].filter(p => !p.dead).length;
  }

  // ---------- 快照 ----------
  snapshotFor(pid) {
    const p = this.players.get(pid);
    const entities = [...this.entities.values()].filter(e => !e.dead || e.kind === 'npc').map(e => {
      const pl = e.kind === 'player' ? this.players.get(e.playerId) : null;
      return {
        eid: e.eid, kind: e.kind, name: e.name, icon: e.icon, x: e.x, y: e.y, hp: Math.max(0, e.hp), maxHp: e.maxHp, ac: e.ac,
        faction: e.faction, playerId: e.playerId, downed: !!e.downed, hidden: !!e.hidden, prone: !!e.prone, webSkip: !!e.webSkip,
        level: e.level, boss: !!e.boss, finalBoss: !!e.finalBoss, npcId: e.npcId, size: e.size || 1,
        // F-25/F-26/F-29：敏捷（先攻）、蓝条（法术位资源）、视野与暴露状态
        defKey: e.defKey,
        dex: e.kind === 'player' ? (pl?.sheet?.stats?.DEX ?? 10) : (e.dex ?? 10),
        mp: e.kind === 'player' ? (pl?.slots?.[1] || 0) : (e.mp || 0),
        maxMp: e.kind === 'player' ? (pl?.sheet?.spells?.length ? (pl.level >= 2 ? 3 : 2) : 0) : (e.maxMp || 0),
        vision: e.kind === 'monster' ? this.visionOf(e) : 0,
        alert: e.kind === 'monster' ? (e.alert || 'calm') : null,
        lastSeen: e.kind === 'monster' ? (e.lastSeen || null) : null,
      };
    });
    const exits = [];
    if (this.map.exit) {
      const need = this.map.exit.need;
      exits.push({ x: this.map.exit.x, y: this.map.exit.y, label: this.map.exit.label, to: this.map.exit.to, open: !need || this.flags.has(need) || this.flags.has('obj:' + need) });
    }
    if (this.map.exit2) {
      const need = this.map.exit2.need;
      exits.push({ x: this.map.exit2.x, y: this.map.exit2.y, label: this.map.exit2.label, to: this.map.exit2.to, open: !need || this.flags.has(need) || this.flags.has('obj:' + need) });
    }
    const code = { floor: '.', grass: 'g', wall: '#', water: '~', rubble: '^', door: 'D', tree: 'T' };
    const tiles = this.map.tiles.map(row => row.map(t => code[t.type] || '.'));
    const chests = this.map.chests.map((c, i) => ({ x: c.x, y: c.y, desc: c.desc, opened: this.openedChests.has(this.chapter.id + ':' + c.x + ':' + c.y) }));
    const props = (this.map.props || []).map(pr => ({ x: pr.x, y: pr.y, type: pr.type, searched: this.searchedProps.has(this.chapter.id + ':' + pr.x + ':' + pr.y) }));
    const players = [...this.players.entries()].map(([id, pl]) => ({
      id, name: pl.name, sheet: pl.sheet, gold: pl.gold, level: pl.level, items: pl.items, keys: pl.keys,
      dead: pl.dead, downed: pl.downed, eid: pl.eid, slots: pl.slots,
      states: this.playerStateSummary(pl), // F-23：玩家状态机摘要
      stats: this.state === 'ended' ? pl.stats : undefined,
    }));
    let me = null;
    if (p) {
      const myGoal = p.goals[0] ? { id: p.goals[0].id, name: p.goals[0].name, text: p.goals[0].text, status: p.goals[0].status } : null;
      me = {
        pid, name: p.name, sheet: p.sheet, gold: p.gold, level: p.level, xp: p.xp, xpNeed: XP_NEED[p.level] || 0, items: p.items, keys: p.keys, slots: p.slots,
        charges: p.charges, eid: p.eid, downed: p.downed, dead: p.dead, claimCooldown: p.claimCooldown,
        states: this.playerStateSummary(p), // F-23：玩家状态机摘要
        goal: myGoal, stats: p.stats, attacks: this.playerAttacks(p), bonusAttacks: this.bonusAttacks(p),
      };
    }
    const dlg = this.dialogues.get(pid) || null;
    return {
      state: this.state, dungeon: { id: this.dungeon.id, name: this.dungeon.name, publicGoal: this.dungeon.publicGoal },
      chapter: { id: this.chapter.id, name: this.chapter.name, place: this.chapter.place, intro: this.chapter.intro,
        objective: this.chapter.objective, objectiveDone: this.flags.has('obj:' + this.chapter.objective.id) },
      map: { w: this.map.w, h: this.map.h, tiles, chests, props, theme: this.mapTheme || null },
      entities, players, me, exits,
      turn: this.turn ? { playerId: this.turn.playerId, moveLeft: this.turn.moveLeft, actionUsed: this.turn.actionUsed, bonusUsed: this.turn.bonusUsed, actorEid: this.turn.actorEid, kind: this.turn.kind || 'player' } : null,
      combat: { active: this.combat.active, round: this.combat.round, order: this.combat.order },
      // F-23：团队状态机；F-30：营地状态；F-24：竖状区域顺序（战斗中=先攻顺序，冒险中=团队敏捷降序）与事件树
      team: { state: this.teamState, combat: this.combat.active, camp: !!this.camp?.active },
      camp: this.camp?.active ? { active: true, merchant: this.camp.merchant, ownerPid: this.camp.ownerPid, ownerName: this.players.get(this.camp.ownerPid)?.name || '' } : null,
      bossVote: this.pendingBoss ? {
        active: true, bossEid: this.pendingBoss.bossEid,
        bossName: this.entities.get(this.pendingBoss.bossEid)?.name || 'BOSS',
        bossIcon: this.entities.get(this.pendingBoss.bossEid)?.icon || '👑',
        agree: [...this.pendingBoss.votes.values()].filter(v => v === 'agree').length,
        flee: [...this.pendingBoss.votes.values()].filter(v => v === 'flee').length,
        total: [...this.players.values()].filter(x => !x.dead).length,
        myVote: this.pendingBoss.votes.get(pid) || null,
      } : null,
      orderStrip: this.combat.active && this.combat.order.length ? [...this.combat.order] : this._teamOrder(),
      eventTrees: this._eventTreesSnapshot(),
      combatEvents: this.combatEvents.slice(-160),
      tuning: Object.fromEntries(Object.entries(this.tuning?.chapters || {}).map(([k, v]) => [k, { hpMul: v.hpMul, dmgMul: v.dmgMul, countDelta: v.countDelta }])),
      flags: [...this.flags].filter(f => !f.startsWith('dlg:')), xpPool: this.xpPool,
      clues: this.clues.slice(-50).map(c => ({ seq: c.seq, text: c.text, ts: c.ts })),
      win: this.win,
      startedAt: this.startedAt,
      speed: this.speed, paused: this.paused, mode: this.room.mode || 'auto',
      dialogue: dlg,
      log: this.log.filter(l => !l.private || l.private === pid).slice(-120), // 私密日志仅本人可见
      personaId: this.personaId,
      npcDefs: this._npcDefsFor(pid),
    };
  }
  _teamOrder() {
    const es = [];
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const e = this.entities.get(p.eid);
      if (e && !e.dead) es.push(e);
    }
    return es.sort((a, b) => this._dexOf(b) - this._dexOf(a)).map(e => e.eid);
  }
  _eventTreesSnapshot() {
    const out = {};
    for (const [pid, tree] of this.eventTrees) out[pid] = tree.slice(-80);
    return out;
  }
  _npcDefsFor(pid) {
    const p = this.players.get(pid);
    const out = {};
    for (const ent of this.entities.values()) {
      if (ent.kind !== 'npc' || !ent.npcId) continue;
      const npcDef = NPCS[ent.npcId];
      if (!npcDef) continue;
      out[ent.npcId] = {
        id: npcDef.id, name: npcDef.name, icon: npcDef.icon, title: npcDef.title,
        greet: this.npcTextOf(npcDef.id, 'greet', null, npcDef.greet), // F-32：AI DM对话变体
        options: npcDef.options.map(o => {
          let available = true, hint = null;
          if (o.need && !(p ? p.keys.includes(o.need) : false) && !this.keys.has(o.need)) { available = false; hint = o.missingText || '缺少道具'; }
          if (o.once && this.flags.has('dlg:' + ent.npcId + ':' + o.id)) available = false;
          if (o.cost && o.cost.gold > (p ? p.gold : 0)) { available = false; hint = '金币不足'; }
          return { id: o.id, text: this.npcTextOf(npcDef.id, 'option', o.id, o.text), tag: o.tag, available, hint,
            rescue: !!(o.need && o.tag === 'aid') }; // 机器可读标记：解救类选项（文本经AI变体后可能不含"解救"字样，禁止用文本匹配）
        }),
      };
    }
    return out;
  }
}
