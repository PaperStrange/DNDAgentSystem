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

const SPELLS = {
  firebolt: { id: 'firebolt', name: '火焰箭', icon: '🔥', kind: 'spellAttack', bonusAttr: 'INT', dice: '1d10', range: 12, cost: 'cantrip', type: '火焰', desc: '对单体掷法术攻击，1d10火焰伤害' },
  magicmissile: { id: 'magicmissile', name: '魔法飞弹', icon: '✨', kind: 'autoHit', dice: '3d4+3', range: 12, cost: 'slot', type: '力场', desc: '3枚飞弹自动命中，3d4+3伤害' },
  burninghands: { id: 'burninghands', name: '燃烧之手', icon: '🧤', kind: 'aoe', dice: '2d6', range: 3, cost: 'slot', type: '火焰', save: 'DEX', desc: '指定3x3区域，2d6火焰伤害，敏捷豁免减半' },
  sacredflame: { id: 'sacredflame', name: '圣光', icon: '☀️', kind: 'saveAttack', bonusAttr: 'WIS', dice: '1d8', range: 10, cost: 'cantrip', type: '光耀', save: 'DEX', desc: '目标敏捷豁免，失败1d8光耀伤害' },
  healingword: { id: 'healingword', name: '治愈祷言', icon: '💖', kind: 'heal', dice: '1d4', range: 6, cost: 'slot', bonusAction: true, desc: '附赠动作：治疗1d4+感知调整' },
  bless: { id: 'bless', name: '祝福术', icon: '🙏', kind: 'bless', range: 6, cost: 'slot', desc: '至多3名队友攻击掷骰+1d4，持续到战斗结束' },
  huntersmark: { id: 'huntersmark', name: '猎人印记', icon: '🎯', kind: 'mark', range: 10, cost: 'special', bonusAction: true, desc: '附赠动作：标记敌人，你对它的伤害+1d6（每场战斗1次）' },
};
const FEATURES = {
  dragonbreath: { id: 'dragonbreath', name: '龙息', icon: '🐲', kind: 'aoe', dice: '2d6', range: 3, cost: 'chapter', type: '火焰', save: 'DEX', desc: '指定3x3区域，2d6火焰伤害，敏捷豁免减半（每章1次）' },
  channeldivinity: { id: 'channeldivinity', name: '引导神力', icon: '🌟', kind: 'heal', dice: '2d8', range: 6, cost: 'chapter', desc: '治疗2d8+感知调整（每章1次）' },
  tactician: { id: 'tactician', name: '战术大师', icon: '🎖️', kind: 'advantage', cost: 'combat', desc: '本次攻击获得优势（每场战斗1次）' },
  huntermark2: { id: 'huntersmark2', name: '猎人印记', icon: '🎯', kind: 'mark', range: 10, cost: 'combat', bonusAction: true, desc: '附赠动作：标记敌人，对其伤害+1d6（每场战斗1次）' },
};

let SEQ = 1;

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
  actorEvent(actorE, text, targetE = null) {
    if (!this.combat.active) return;
    const ev = { seq: SEQ++, round: this.combat.round || 1, actorEid: actorE?.eid || null, actorName: actorE?.name || '', targetEid: targetE?.eid || null, targetName: targetE?.name || '', text, ts: Date.now() };
    this.combatEvents.push(ev);
    if (this.combatEvents.length > 300) this.combatEvents.splice(0, this.combatEvents.length - 300);
    const pids = new Set();
    if (actorE?.playerId) pids.add(actorE.playerId);
    if (targetE?.playerId) pids.add(targetE.playerId);
    for (const pid of pids) {
      let tree = this.eventTrees.get(pid);
      if (!tree) { tree = []; this.eventTrees.set(pid, tree); }
      tree.push(ev);
      if (tree.length > 120) tree.splice(0, tree.length - 120);
    }
  }

  // ---------- 日志 ----------
  logMsg(kind, text, extra = {}) {
    this.log.push({ seq: SEQ++, kind, text, ts: Date.now(), ...extra });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }
  event(t, data) {
    this.events.push({ seq: SEQ, t, ts: Date.now(), ...data });
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }
  narrate(key, ctx = {}, extra = {}) {
    const text = this.director.narrate(this, key, ctx);
    this.logMsg('narr', text, { dm: true, ...extra });
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
  _startFirstTurn() {
    const pid = this.seatOrder.find(id => this.players.get(id) && !this.players.get(id).dead);
    if (pid === undefined) return this._endGame('defeat', '没有可行动的玩家');
    this._startPlayerTurn(pid);
  }
  _startPlayerTurn(pid) {
    const p = this.players.get(pid);
    if (!p || p.dead) return this._endTurn();
    const e = this.entities.get(p.eid);
    if (!e || e.dead) return this._endTurn();
    this.turn = { actorEid: e.eid, playerId: pid, kind: 'player', moveLeft: e.speed, actionUsed: false, bonusUsed: false, round: this.combat.active ? this.combat.round : 0 };
    // 回合看门狗：自动模式在线8秒/离线2.5秒防挂机（自动模式由策略驱动，8秒足以容错拥堵）；
    // F-27：手动模式玩家回合不自动结束——只有点击「结束回合」按钮才进入下一顺位（离线掉线保留2.5秒跳过防死锁）；
    // F-30：营地休整者的回合不设看门狗（等待其选择恢复/购买/回到冒险）
    if (this.turnTimer) clearTimeout(this.turnTimer);
    const isManual = this.room.mode === 'manual';
    const online = this.isPlayerOnline(pid);
    const timeoutMs = isManual ? (online ? 0 : 2500) : (online ? 8000 : 2500);
    if (timeoutMs > 0 && !this.camp?.active) {
      this.turnTimer = this.later(timeoutMs, () => {
        if (this.state === 'playing' && this.turn && this.turn.kind === 'player' && this.turn.playerId === pid) {
          this.logMsg('system', '⏳ ' + e.name + ' 未行动，回合自动跳过');
          this._endTurn();
        }
      });
    }
    if (e.webSkip) { // 被蛛网缠住：跳过本回合（F-23：debuff状态机清除）
      e.webSkip = false;
      this.removeDebuff(pid, 'web');
      this.logMsg('system', '🕸️ ' + e.name + ' 被蛛网缠住，动弹不得！');
      this._endTurn();
      return;
    }
    if (p.downed) {
      // 死亡豁免
      const r = d20();
      if (p.sheet.race === 'halforc' && p.deathSaves.f === 0) { p.deathSaves.f = 0; }
      if (r.total === 20) { p.deathSaves = { s: 0, f: 0 }; p.downed = false; e.hp = 1; this.logMsg('system', '💫 奇迹！' + e.name + ' 以1点生命苏醒！', { imp: 'key' }); this.narrate('down', { actor: e.name }); }
      else if (r.total >= 10) { p.deathSaves.s++; this.logMsg('dice', '💀 ' + e.name + ' 死亡豁免：d20=' + r.total + ' 成功(' + p.deathSaves.s + '/3)', { imp: 'minor' }); }
      else {
        if (p.sheet.race === 'halforc') { p.deathSaves.f--; p.sheet._usedResilience = true; }
        p.deathSaves.f++;
        this.logMsg('dice', '💀 ' + e.name + ' 死亡豁免：d20=' + r.total + ' 失败(' + p.deathSaves.f + '/3)', { imp: 'key' });
      }
      if (p.sheet.race === 'halforc' && p.deathSaves.f === 0 && r.total < 10) { p.deathSaves.f = 0; }
      if (p.deathSaves.f >= 3) { this._killPlayer(p); return this._endTurn(); }
      if (p.deathSaves.s >= 3) { p.stable = true; this.logMsg('system', '🩹 ' + e.name + ' 伤势稳定了。'); }
      this._endTurn();
      return;
    }
    this.logMsg('system', '🎯 ' + e.name + ' 的回合');
    this._visionCheck(); // F-29：回合开始先做视野检测（发现→暴露→开战）
    this.onChange();
  }
  _endTurn() {
    if (this.state !== 'playing') return;
    // F-30：营地期间回合不转移给他人（即使自动模式看门狗/离线跳过触发），保持休整者的回合
    if (this.camp?.active && this.turn?.playerId !== this.camp.ownerPid) {
      if (this.camp.ownerPid && this.players.get(this.camp.ownerPid) && !this.players.get(this.camp.ownerPid).dead) {
        this._startPlayerTurn(this.camp.ownerPid);
        return;
      }
    }
    const prev = this.turn;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    this.turn = null;
    // 自愈：战斗激活但先攻顺序为空 → 按阵营敏捷规则（F-25）重建
    if (this.combat.active && (!this.combat.order || !this.combat.order.length)) {
      const playerEs = [];
      for (const [pid, p] of this.players) {
        if (p.dead) continue;
        const e = this.entities.get(p.eid);
        if (e && !e.dead) playerEs.push(e);
      }
      this.combat.order = this._buildCombatOrder(playerEs, this._aliveEnemies(), false).map(e => e.eid);
      this.logMsg('combat', '🔄 先攻顺序重建（阵营敏捷规则，' + this.combat.order.length + '名参战者）');
    }
    const order = this.combat.order;
    if (this.combat.active && order.length) {
      this.combat.idx++;
      if (this.combat.idx >= order.length) {
        this.combat.idx = 0;
        this.combat.round++;
        this.logMsg('combat', '━━━ 第' + this.combat.round + '回合 ━━━', { imp: 'minor' });
        this.narrate('roundStart', { n: this.combat.round }); // F-37：回合开始人设旁白
        this.director.flourish(this, 'roundStart', { n: this.combat.round }); // BUG-4：回合开始LLM加戏（常规事件，受每场≤4次上限约束）
        for (const eid of order) { const e = this.entities.get(eid); if (e && e.kind === 'player') { const p = this.players.get(e.playerId); if (p) p.halflingReroll = true; } }
      }
    }
    // 检查战斗结束
    if (this.combat.active && !this._aliveEnemies().length) { this._endCombat(); }
    const next = this._nextActor();
    if (next) {
      if (next.kind === 'monster') {
        this.turn = { actorEid: next.eid, kind: 'monster', round: this.combat.round };
        this._scheduleMonsterTurn(next.eid);
      } else {
        this._startPlayerTurn(next.playerId);
      }
      this.onChange();
      return;
    }
    // 非战斗：轮转到下一位座位玩家
    this._nextSeatTurn(prev && prev.playerId ? prev.playerId : this.seatOrder[0]);
  }
  _nextActor() {
    if (!this.combat.active || !this.combat.order.length) return null;
    if (this.combat.idx >= this.combat.order.length) this.combat.idx = 0;
    const eid = this.combat.order[this.combat.idx];
    const e = this.entities.get(eid);
    if (!e || e.dead || e.hp <= 0) return null;
    return e;
  }
  _nextSeatTurn(fromPid) {
    const ids = this.seatOrder;
    const start = ids.indexOf(fromPid);
    const idx0 = start >= 0 ? start + 1 : 0;
    for (let i = 0; i < ids.length; i++) {
      const pid = ids[(idx0 + i) % ids.length];
      const p = this.players.get(pid);
      if (!p || p.dead) continue;
      this._startPlayerTurn(pid);
      return;
    }
  }
  _aliveEnemies() {
    return [...this.entities.values()].filter(e => e.kind === 'monster' && !e.dead);
  }

  // ---------- 战斗 ----------
  // F-25：阵营敏捷比较——先攻顺序构建。同一阵营敏捷高者先动；玩家先动时团队打头，否则敏捷高的一方先动（平局团队先动）
  _dexOf(e) {
    if (e.kind === 'player') {
      const p = this.players.get(e.playerId);
      return p?.sheet?.stats?.DEX ?? 10;
    }
    return e.dex ?? MONSTERS[e.defKey]?.dex ?? 10;
  }
  _buildCombatOrder(playerEs, monsterEs, playersFirst) {
    const byDex = (list) => list.slice().sort((a, b) => (this._dexOf(b) - this._dexOf(a)) || a.eid.localeCompare(b.eid));
    const ps = byDex(playerEs), ms = byDex(monsterEs);
    if (playersFirst) return [...ps, ...ms];
    const pMax = ps.length ? Math.max(...ps.map(e => this._dexOf(e))) : -Infinity;
    const mMax = ms.length ? Math.max(...ms.map(e => this._dexOf(e))) : -Infinity;
    return pMax >= mMax ? [...ps, ...ms] : [...ms, ...ps];
  }
  _alertSquad(m, opts = {}) {
    if (this.combat.active && this.combat.squads.has(m.squad)) return;
    const squad = this._aliveEnemies().filter(x => x.squad === m.squad);
    if (this.combat.active) {
      // 增援：新小队加入进行中的战斗——排在当前行动者之后，队内按敏捷高低
      this.combat.squads.add(m.squad);
      const news = squad.filter(e => !this.combat.order.includes(e.eid))
        .sort((a, b) => (this._dexOf(b) - this._dexOf(a)) || a.eid.localeCompare(b.eid));
      if (news.length) {
        const at = this.combat.idx + 1;
        this.combat.order.splice(at, 0, ...news.map(e => e.eid));
        for (const e of news) this.logMsg('dice', '⚔️ ' + e.name + ' 加入战斗！');
      }
      this.onChange();
      return;
    }
    this.combatCount++;
    const firstCombat = this.combatCount === 1;      // 首次进入游戏：默认玩家第一回合第一顺位
    const surprise = !!opts.surprise;                // 未被怪物发现时玩家先手攻击=突袭
    const playerEs = [];
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const e = this.entities.get(p.eid);
      if (e && !e.dead) playerEs.push(e);
    }
    const order = this._buildCombatOrder(playerEs, squad, firstCombat || surprise);
    this.combat = { active: true, round: 1, order: order.map(e => e.eid), idx: 0, squads: new Set([m.squad]) };
    this.combatEvents = [];   // F-24：新战斗重置事件树
    this._enterCombatState(); // F-23：团队与全员进入「战斗中」
    const why = surprise ? '（突袭：你们未被发现，先发制人！）' : (firstCombat ? '（首场遭遇：冒险者率先行动）' : '（比较阵营敏捷：' + (order[0]?.kind === 'player' ? '团队更高，先行动' : '敌方更高，先行动') + '）');
    this.logMsg('combat', '━━━ ⚔️ 战斗开始！' + why + ' ━━━', { imp: 'key' });
    for (const e of order) {
      this.logMsg('dice', (e.kind === 'player' ? '🎲 ' : '⚔️ ') + e.name + ' 敏捷 ' + this._dexOf(e), { imp: 'minor' });
    }
    this.logMsg('combat', '━━━ 第1回合 ━━━', { imp: 'minor' });
    this.narrate('combatStart', {});
    this.director.flourish(this, 'combatStart'); // F-37：开战LLM加戏（异步，节流）
    if (!surprise && order[0]?.kind === 'player') {
      const tp = this.players.get(order[0].playerId);
      if (tp) tp.stats.initiativeWins++;
    }
    // 手动模式：战斗在玩家行动中触发时保留其当前回合，结束后按先攻顺序继续（严格回合制）
    if (this.room.mode === 'manual' && this.turn && this.turn.kind === 'player') {
      const myIdx = order.findIndex(o => o.eid === this.turn.actorEid);
      if (myIdx >= 0) this.combat.idx = myIdx; // _endTurn会先idx++，落点即我的下一位
      this.onChange();
      return;
    }
    this.turn = null;
    this._endTurn();
  }
  _endCombat() {
    this.director.noteEncounterEnd(this); // S1-4：战斗数据重置前快照战况，胜负旁白摘要用
    this.combat = { active: false, round: 0, order: [], idx: 0 };
    for (const [pid, p] of this.players) { p.blessed = false; p.mark = null; this.removeBuff(pid, 'bless'); this.removeBuff(pid, 'mark'); }
    this._exitCombatState(); // F-23：战斗结束→团队与全员回到「冒险中」
    this.logMsg('combat', '━━━ 🏳️ 战斗结束 ━━━', { imp: 'key' });
    this._checkSquadDead();
  }
  _checkSquadDead() {
    const bySquad = new Map();
    for (const e of this._aliveEnemies()) {
      if (!bySquad.has(e.squad)) bySquad.set(e.squad, []);
      bySquad.get(e.squad).push(e);
    }
    // 记录已经全灭的小队
    const allSquads = new Set();
    for (const e of this.entities.values()) if (e.kind === 'monster') allSquads.add(e.squad);
    for (const sq of allSquads) {
      const alive = this._aliveEnemies().filter(x => x.squad === sq);
      if (!alive.length) this.deadSquads.add(this.chapter.id + ':' + sq);
    }
  }

  _scheduleMonsterTurn(eid) {
    const run = () => {
      if (this.state !== 'playing') return;
      const e = this.entities.get(eid);
      if (!e || e.dead || e.hp <= 0) return this._endTurn();
      this._monsterAct(e);
    };
    // 手动模式：严格回合制——怪物回合等待玩家确认推进（game:endturn），不自动行动
    if (this.room.mode === 'manual') {
      this._pendingMonster = run;
      this.logMsg('system', '⚔️ 敌方回合：' + (this.entities.get(eid)?.name || '？') + ' 待命（点击「推进敌方回合」或回车）');
      this.onChange();
      return;
    }
    const delayMs = Math.max(120, Math.round(450 / (this.speed || 1))); // 自动模式：速度倍率影响怪物行动节奏
    this.later(delayMs, () => {
      if (this.state !== 'playing') return;
      if (this.paused) { this._scheduleMonsterTurn(eid); return; } // 暂停：重新排队等待
      run();
    });
  }
  _monsterAct(e) {
    if (e.webSkip) { e.webSkip = false; this.logMsg('system', '🕸️ ' + e.name + ' 被蛛网缠住，动弹不得！'); return this._endTurn(); }
    // 选目标：最近的存活玩家（优先近处）
    let target = null, best = Infinity;
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const pe = this.entities.get(p.eid);
      if (!pe || pe.dead || pe.hp <= 0) continue;
      const d = manhattan(e, pe);
      if (d < best) { best = d; target = pe; }
    }
    if (!target) return this._endTurn();
    const melee = e.attacks.find(a => a.range <= 2);
    const ranged = e.attacks.find(a => a.range > 2);
    const distT = manhattan(e, target);
    const pm = this.pathMap(false); // 怪物路径：玩家挡路
    if (melee && distT <= melee.range) { this._performAttack(e, target, melee); return this._endTurn(); }
    if (ranged && distT <= ranged.range && losClear(pm, e, target)) { this._performAttack(e, target, ranged); return this._endTurn(); }
    // 移动接近
    const path = findPath(pm, e, target, e.speed, { passEntities: false, ignoreEntityId: e.eid });
    let steps = 0;
    for (const step of path) {
      if (steps >= e.speed) break;
      const d = manhattan(step, target);
      if (melee && d <= melee.range) break;
      if (!melee && ranged && d <= ranged.range && losClear(pm, { x: step.x, y: step.y }, target)) break;
      e.x = step.x; e.y = step.y; steps++;
    }
    if (melee && manhattan(e, target) <= melee.range) { this._performAttack(e, target, melee); }
    else if (ranged && manhattan(e, target) <= ranged.range && losClear(pm, e, target)) { this._performAttack(e, target, ranged); }
    this._endTurn();
  }

  // ---------- 攻击结算 ----------
  _performAttack(att, def, atk, opts = {}) {
    if (def.dead || def.hp <= 0 || att.dead) return;
    const attName = att.name, defName = def.name;
    this.logMsg('combat', '⚔️ ' + attName + ' 对 ' + defName + ' 使用' + atk.name);
    this.narrate('attack', { actor: attName, target: defName });
    if (atk.autoHit) {
      const mul = atk.dmgMul || 1;
      const d = roll(atk.dmg);
      const dmg = Math.max(1, Math.round(d.total * mul));
      this.logMsg('dice', '✨ 魔法飞弹自动命中！伤害 ' + atk.dmg + '=' + d.total + (mul !== 1 ? '×' + mul : ''));
      this._applyDamage(def, dmg, att, { type: atk.type || '力场' });
      this.actorEvent(att, '✨ 魔法飞弹命中' + defName + '，造成' + dmg + '点伤害', def);
      return;
    }
    if (atk.web) {
      const r = d20();
      const mod = this._monsterSaveMod(def, 'DEX');
      const save = r.total + mod;
      this.logMsg('dice', '🕸️ ' + defName + ' 敏捷豁免：d20=' + r.total + '+' + mod + '=' + save + ' vs DC' + atk.web.dc + (save >= atk.web.dc ? ' 成功！' : ' 失败，被缠住！'));
      if (save < atk.web.dc) {
        def.webSkip = true;
        if (def.kind === 'player') this.addDebuff(def.playerId, { id: 'web', name: '蛛网缠绕', icon: '🕸️' }); // F-23：debuff状态机
      }
      return;
    }
    let adv = opts.adv || 0, dis = opts.dis || 0;
    if (def.prone && atk.range <= 2) adv++;
    if (att.hidden) { adv++; att.hidden = false; }
    const r1 = d20(), r2 = adv || dis ? d20() : null;
    let use = r1;
    if (adv && !dis) use = r1.total >= r2.total ? r1 : r2;
    if (dis && !adv) use = r1.total <= r2.total ? r1 : r2;
    const total = use.total + (atk.bonus || 0);
    const nat20 = use.total === 20, nat1 = use.total === 1;
    let hit = nat20 ? true : nat1 ? false : total >= def.ac;
    if (nat20) { hit = true; }
    if (!hit && (adv || dis)) this.logMsg('dice', '🎲 ' + attName + ' 攻击：d20=' + r1.total + (r2 ? '/' + r2.total : '') + '+' + (atk.bonus || 0) + '=' + total + ' vs AC' + def.ac + '（未命中）', { imp: 'minor' });
    else if (nat20) this.logMsg('dice', '🎲 ' + attName + ' 攻击：d20=20（自然20）+' + (atk.bonus || 0) + '=' + total + ' vs AC' + def.ac + '（重击！）', { imp: 'key' });
    else if (nat1) this.logMsg('dice', '🎲 ' + attName + ' 攻击：d20=1（自然1）+' + (atk.bonus || 0) + ' vs AC' + def.ac + '（大失败！）', { imp: 'key' });
    else this.logMsg('dice', '🎲 ' + attName + ' 攻击：d20=' + use.total + '+' + (atk.bonus || 0) + '=' + total + ' vs AC' + def.ac + '（' + (hit ? '命中' : '未命中') + '！）', { imp: 'minor' });
    if (!hit) {
      if (att.kind === 'player') { const p = this.players.get(att.playerId); if (p) p.stats.attacksMissed++; }
      this.narrate(nat1 ? 'fumble' : 'miss', { actor: attName, target: defName });
      this.director.flourish(this, nat1 ? 'fumble' : 'miss', { actor: attName, target: defName }); // S1-4：常规事件LLM加戏
      this.event('attack', { att: att.eid, def: def.eid, hit: false });
      return;
    }
    if (nat20) this.narrate('crit', { actor: attName, target: defName, dmg: '?' });
    if (nat20) {
      this.director.noteCombat(attName + '对' + defName + '打出了致命暴击'); // S1-4：战况摘要素材
      this.director.flourish(this, 'crit', { actor: attName, target: defName }); // F-37：暴击LLM加戏
    }
    const mul = atk.dmgMul || 1; // F-22/F-32：AI DM调校的伤害倍率
    const d = roll(atk.dmg);
    let dmg = Math.max(1, Math.round(d.total * mul));
    if (nat20) dmg = Math.max(1, Math.round((d.total + roll(atk.dmg.replace(/\+\d+$/, '')).total) * mul));
    this._applyDamage(def, dmg, att, { type: atk.type || '物理', crit: nat20, attack: atk });
    this.actorEvent(att, '⚔️ 用' + atk.name + '攻击' + defName + '：命中，造成' + dmg + '点伤害' + (nat20 ? '（重击）' : ''), def);
    if (!nat20) this.director.flourish(this, 'hit', { actor: attName, target: defName }); // BUG-4：普通命中LLM加戏（常规事件，受每场≤4次上限约束）
    if (atk.poison && !def.dead) {
      const r = d20();
      const mod = this._monsterSaveMod(def, 'CON');
      const save = r.total + mod;
      const ok = save >= atk.poison.dc;
      this.logMsg('dice', '☠️ ' + defName + ' 体质豁免 vs 毒素：d20=' + r.total + '+' + mod + '=' + save + (ok ? ' 成功！' : ' 失败，中毒！'));
      if (!ok) { const pd = roll(atk.poison.dmg); this._applyDamage(def, pd.total, att, { type: '毒素' }); }
    }
    if (atk.onHit && !def.dead) {
      const r = d20();
      const mod = this._monsterSaveMod(def, atk.onHit.save);
      const save = r.total + mod;
      this.logMsg('dice', '💥 ' + defName + ' ' + (atk.onHit.save === 'STR' ? '力量' : '敏捷') + '豁免：d20=' + r.total + '+' + mod + '=' + save + (save >= atk.onHit.dc ? ' 成功！' : ' 失败，被击倒！'));
      if (save < atk.onHit.dc) {
        def.prone = true;
        if (def.kind === 'player') this.addDebuff(def.playerId, { id: 'prone', name: '倒地', icon: '🌀' }); // F-23：debuff状态机
      }
    }
  }
  _monsterSaveMod(e, attr) {
    if (e.kind === 'player') {
      const p = this.players.get(e.playerId);
      return p.sheet.mods[attr] || 0;
    }
    const m = MONSTERS[e.defKey];
    if (m.saves && m.saves[attr] !== undefined) return m.saves[attr];
    return e.boss ? 2 : 1;
  }
  _applyDamage(def, dmg, src, { type = '物理', crit = false } = {}) {
    if (def.dead || dmg <= 0) return;
    def.hp -= dmg;
    const srcP = src.kind === 'player' ? this.players.get(src.playerId) : null;
    if (srcP) srcP.stats.damageDealt += dmg;
    if (def.kind === 'player') {
      const p = this.players.get(def.playerId);
      p.stats.damageTaken += dmg;
      if (this.chapterPerf) this.chapterPerf.damageTaken += dmg; // F-32：本章表现统计
    }
    this.logMsg('combat', '💥 ' + def.name + ' 受到 ' + dmg + ' 点' + type + '伤害' + (crit ? '（重击）' : '') + '（剩余' + Math.max(0, def.hp) + '/' + def.maxHp + '）', crit ? { imp: 'key' } : {});
    this.event('damage', { src: src.eid, def: def.eid, dmg, type, crit });
    if (def.hp <= 0) {
      def.hp = 0;
      if (def.kind === 'monster') this._killMonster(def, srcP);
      else if (def.kind === 'player') this._downPlayer(def);
    }
    if (srcP && src.kind === 'player') this._checkPublicWin();
    this._checkTpk();
  }
  _killMonster(e, killer) {
    e.dead = true;
    if (this.combat.order) {
      const pos = this.combat.order.indexOf(e.eid);
      if (pos >= 0) {
        this.combat.order.splice(pos, 1);
        if (this.combat.idx > pos) this.combat.idx--;
      }
    }
    this.narrate('kill', { actor: killer ? killer.name : '众人', target: e.name });
    this.director.noteCombat(e.name + '被' + (killer ? killer.name : '众人') + '击倒'); // S1-4：战况摘要素材
    this.director.flourish(this, 'kill', { actor: killer ? killer.name : '众人', target: e.name }); // S1-4：常规事件LLM加戏
    this.logMsg('combat', (e.boss || e.finalBoss ? '👑 BOSS「' : '☠️ ') + e.name + (e.boss || e.finalBoss ? '」' : '') + ' 被击败！', { imp: 'key' });
    this.event('kill', { def: e.eid, killer: killer ? killer.pid : null });
    // 掉落
    let goldAmt = 0;
    if (e.gold) { const g = roll(e.gold); goldAmt = g.total; }
    let receiver = killer;
    if (!receiver) {
      const cand = [...this.players.values()].find(p => !p.dead);
      receiver = cand || null;
    }
    if (receiver && goldAmt > 0) { receiver.gold += goldAmt; receiver.stats.goldEarned += goldAmt; this.logMsg('system', '💰 ' + receiver.name + ' 拾取了 ' + goldAmt + ' 金币'); }
    if (killer) {
      killer.stats.kills++;
      killer.stats.lastHits++;
      if (this.chapterPerf) this.chapterPerf.kills++;
      if (e.finalBoss) killer.stats.bossLastHit = true;
    }
    if (e.boss || e.finalBoss) {
      this.actorEvent(killer || null, '💀 击杀了BOSS「' + e.name + '」', e);
      this.director.flourish(this, 'bossDown', { target: e.name }); // F-37：BOSS倒下LLM加戏
    }
    if (e.lootKey && !this.keys.has(e.lootKey)) {
      this.keys.add(e.lootKey);
      this.logMsg('system', '🔑 队伍获得了【' + (e.lootKey === 'cage_key' ? '笼子钥匙' : '城堡钥匙') + '】');
      this.addClue(e.lootKey === 'cage_key' ? '获得笼子钥匙：可打开克拉格莫洞穴中的牢笼，救出西达尔' : '获得城堡钥匙：可打开克拉格莫城堡的大门');
    }
    if (e.xp) {
      this.xpPool += e.xp;
      for (const pl of this.players.values()) if (!pl.dead) pl.xp += e.xp; // 经验全员共享，计入个人经验条
      this._checkXpLevel();
    }
    // 小队全灭检查
    const squadAlive = this._aliveEnemies().filter(x => x.squad === e.squad);
    if (!squadAlive.length) this.deadSquads.add(this.chapter.id + ':' + e.squad);
    this._checkChapterObjective();
    if (e.finalBoss) { this._checkPublicWin(); }
  }
  _downPlayer(e) {
    const p = this.players.get(e.playerId);
    if (!p) return;
    if (e.downed && p.downed) { /* 已倒地再受伤 → 直接视为死亡豁免失败1次 */ p.deathSaves.f++; this.logMsg('dice', '💀 ' + e.name + ' 在倒地中受伤，死亡豁免自动失败(' + p.deathSaves.f + '/3)', { imp: 'key' }); if (p.deathSaves.f >= 3) this._killPlayer(p); return; }
    e.downed = true; p.downed = true; p.stable = false;
    p.stats.downedCount++;
    if (this.chapterPerf) this.chapterPerf.downs++; // F-32：本章表现统计
    p.deathSaves = { s: 0, f: 0 };
    this.addDebuff(p.pid, { id: 'downed', name: '倒地', icon: '💀' }); // F-23：debuff状态机
    this.actorEvent(this.entities.get(this.turn?.actorEid) || null, '💀 ' + e.name + ' 倒下了！', e);
    this.logMsg('combat', '💀 ' + e.name + ' 倒下了！死亡豁免开始计数，需要队友救援', { imp: 'key' });
    this.director.noteCombat(e.name + '倒下了，生死未卜'); // S1-4：战况摘要素材
    this.director.flourish(this, 'playerDown', { actor: e.name }); // F-37：冒险者倒地LLM加戏
    this.narrate('down', { actor: e.name });
    this.event('down', { pid: p.pid });
  }
  _killPlayer(p) {
    p.dead = true;
    const e = this.entities.get(p.eid);
    if (e) e.dead = true;
    this.actorEvent(e || null, '☠️ ' + p.name + ' 阵亡了…', e);
    this.logMsg('combat', '☠️ ' + p.name + ' 阵亡了…', { imp: 'key' });
    this.narrate('death', { actor: p.name });
    this.event('death', { pid: p.pid });
    if (this.turn && this.turn.playerId === p.pid) { this.turn = null; this._endTurn(); }
    this._checkTpk();
  }
  _checkTpk() {
    if (this.state !== 'playing') return;
    const alive = [...this.players.values()].filter(p => !p.dead);
    if (!alive.length) return this._endGame('defeat', '队伍全员倒下，冒险失败');
    const anyStanding = alive.some(p => { const e = this.entities.get(p.eid); return e && !e.dead && !e.downed; });
    if (!anyStanding) this._endGame('defeat', '队伍全员倒下，冒险失败');
  }
  _checkPublicWin() {
    if (this.state !== 'playing') return;
    if (this.chapter.id !== 'cave') return;
    const boss = [...this.entities.values()].find(e => e.finalBoss);
    if (boss && boss.dead) {
      this.flags.add('nezznar_dead');
      this._endGame('public', '黑蜘蛛涅兹纳尔被击败，法术熔炉之光重新亮起！');
    }
  }

  // ---------- 玩家动作 ----------
  getPlayer(pid) { return this.players.get(pid); }
  isPlayerTurn(pid) { return this.turn && this.turn.playerId === pid && this.state === 'playing'; }

  playerAttacks(p) {
    const s = p.sheet;
    const list = s.weapons.map(w => {
      const isMelee = w.range <= 1;
      return { id: 'w:' + w.id, name: w.name, icon: isMelee ? '⚔️' : '🏹', kind: 'weapon', dice: w.dice, mod: w.mod, range: w.range, melee: isMelee };
    });
    for (const sid of s.spells || []) {
      const sp = SPELLS[sid];
      if (sp) list.push({ ...sp, id: 's:' + sid, needsSlot: sp.cost === 'slot', slotLevel: 1 });
    }
    if (s.race === 'dragonborn') list.push({ ...FEATURES.dragonbreath, id: 'f:dragonbreath' });
    if (s.class === 'cleric' && p.level >= 2) list.push({ ...FEATURES.channeldivinity, id: 'f:channeldivinity' });
    if (s.class === 'ranger') list.push({ ...FEATURES.huntermark2, id: 'f:huntermark2' });
    if (s.class === 'fighter' && p.level >= 3) list.push({ ...FEATURES.tactician, id: 'f:tactician' });
    return list;
  }
  bonusAttacks(p) {
    const list = [];
    for (const sid of p.sheet.spells || []) { const sp = SPELLS[sid]; if (sp && sp.bonusAction) list.push({ ...sp, id: 's:' + sid }); }
    if (p.sheet.class === 'ranger') list.push({ ...FEATURES.huntermark2, id: 'f:huntermark2' });
    return list;
  }
  hasSlot(p, cost) {
    if (cost === 'cantrip') return true;
    if (cost === 'slot') return (p.slots?.[1] || 0) > 0;
    if (cost === 'chapter') return (p.charges?.[p._lastCharge] || 0) > 0;
    if (cost === 'combat') return true;
    if (cost === 'special') return true;
    return true;
  }

  actMove(pid, { x, y }) {
    const p = this.players.get(pid);
    const t = this.turn;
    if (!p || !t || t.playerId !== pid) return { ok: false, msg: '不是你的回合' };
    const campG = this._campGuard(pid); if (campG) return campG; // F-30：营地休整中
    const e = this.entities.get(p.eid);
    if (!e || e.dead || e.downed) return { ok: false, msg: '你无法移动' };
    const to = { x: clamp(x, 0, this.map.w - 1), y: clamp(y, 0, this.map.h - 1) };
    const path = findPath(this.pathMap(), e, to, t.moveLeft, { passEntities: false, ignoreEntityId: e.eid });
    if (!path.length && manhattan(e, to) > 0) this.logMsg('system', '⚠ ' + e.name + '@(' + e.x + ',' + e.y + ')[' + (this.map.tiles[e.y] && this.map.tiles[e.y][e.x] ? this.map.tiles[e.y][e.x].type : '?') + '] 无法到达 (' + to.x + ',' + to.y + ')');
    if (process.env.DND_DEBUG) console.log('[move]', pid.slice(-4), 'from(' + e.x + ',' + e.y + ') to(' + to.x + ',' + to.y + ') path=' + path.length + ' budget=' + t.moveLeft);
    let cost = 0;
    for (const step of path) {
      const tile = this.map.tiles[step.y][step.x];
      cost += tile.difficult ? 2 : 1;
      if (cost > t.moveLeft) break;
      e.x = step.x; e.y = step.y;
      t.moveLeft -= (tile.difficult ? 2 : 1);
    }
    if (path.length) this.actorEvent(e, '移动到(' + e.x + ',' + e.y + ')'); // F-24：事件树
    this._visionCheck(); // F-29：移动后视野检测（暴露→立即进入战斗）
    return { ok: true, path };
  }

  actAttack(pid, { targetEid }) {
    const p = this.players.get(pid);
    const t = this.turn;
    if (!p || !t || t.playerId !== pid) return { ok: false, msg: '不是你的回合' };
    if (t.actionUsed) return { ok: false, msg: '本回合已使用动作' };
    const campG = this._campGuard(pid); if (campG) return campG; // F-30：营地休整中
    const e = this.entities.get(p.eid);
    const target = this.entities.get(targetEid);
    if (!e || !target || target.dead) return { ok: false, msg: '目标无效' };
    if (target.kind !== 'monster') return { ok: false, msg: '不能攻击这个目标' };
    // F-30：攻击BOSS必须先经过全队表决（发现BOSS=遭遇表决；战斗中瞄准未表决的BOSS同样先表决后开战）
    if (target.boss && !(this.combat.active && this.combat.squads.has(target.squad))) {
      if (this.pendingBoss) return { ok: false, msg: 'BOSS遭遇需要全队表决：开始战斗或逃跑' };
      this._openBossVote(target, e);
      return { ok: false, msg: '发现BOSS！全队需要表决：开始战斗或逃跑' };
    }
    // F-25：未被怪物发现（小队全体calm）时先手攻击=突袭，战斗首回合团队先动
    const squadCalm = !this.combat.active ? this._aliveEnemies().filter(x => x.squad === target.squad).every(x => x.alert === 'calm') : false;
    t.actionUsed = true;
    if (!this.combat.active || !this.combat.squads.has(target.squad)) this._alertSquad(target, { surprise: squadCalm });
    const atts = this.playerAttacks(p).filter(a => a.kind === 'weapon');
    const melee = atts.find(a => a.melee);
    const ranged = atts.find(a => !a.melee);
    const d = manhattan(e, target);
    let used = null;
    if (melee && d <= melee.range) used = melee;
    else if (ranged && d <= ranged.range && losClear(this.pathMap(), e, target)) used = ranged;
    if (!used) return { ok: false, msg: '目标不在任何武器的射程内（或视线被阻挡）', undo: true };
    const rollDmg = () => {
      const dr = roll(used.dice);
      let dmg = dr.total + (p.sheet.mods[used.mod] || 0);
      if (p.sheet.upgradeWeapon) dmg += 1;
      if (p.sheet.class === 'rogue' && this._hasAllyAdjacent(target)) dmg += roll(p.level >= 3 ? '2d6' : '1d6').total;
      if (p.sheet.class === 'ranger' && p.mark === target.eid) dmg += roll('1d6').total;
      if (p.sheet.class === 'ranger' && ['goblin', 'hobgoblin', 'bugbear', 'klarg', 'grol', 'wolf'].includes(target.defKey)) dmg += 1;
      return { dmg, dr };
    };
    const doAttack = (opts = {}) => {
      let adv = opts.adv || 0, dis = 0;
      if (used.melee && target.prone) adv++;
      if (!used.melee && d <= 1) dis++;
      if (e.hidden) { adv++; e.hidden = false; p.hiddenThisRound = false; }
      let total = 0, nat = 0, nat1 = false, rollTxt = '';
      let useRoll = null;
      const r1 = d20();
      let r2 = null;
      if (adv || dis) r2 = d20();
      const pickRoll = (a, b, takeHigh) => takeHigh ? (a.total >= b.total ? a : b) : (a.total <= b.total ? a : b);
      useRoll = adv && !dis ? pickRoll(r1, r2, true) : (dis && !adv ? pickRoll(r1, r2, false) : r1);
      let blessBonus = 0;
      if (p.blessed) blessBonus = roll('1d4').total;
      total = useRoll.total + p.sheet.attackBonus + blessBonus;
      nat = useRoll.total;
      nat1 = nat === 1;
      if (nat1 && p.sheet.race === 'halfling' && p.halflingReroll) {
        p.halflingReroll = false;
        const rr = d20();
        useRoll = rr; nat = rr.total; nat1 = nat === 1;
        total = rr.total + p.sheet.attackBonus + blessBonus;
        this.logMsg('dice', '🍀 半身人的幸运！重掷攻击骰');
      }
      rollTxt = 'd20=' + r1.total + (r2 ? '/' + r2.total : '') + (p.sheet.attackBonus ? '+' + p.sheet.attackBonus : '') + (blessBonus ? '+1d4(' + blessBonus + ')' : '');
      const crit = nat === 20;
      const hit = nat1 ? false : (crit ? true : total >= target.ac);
      this.logMsg('dice', '🎲 ' + e.name + ' 用' + used.name + '攻击 ' + target.name + '：' + rollTxt + '=' + total + ' vs AC' + target.ac + '（' + (crit ? '重击！' : nat1 ? '大失败！' : hit ? '命中！' : '未命中') + '）', { imp: crit || nat1 ? 'key' : 'minor' });
      if (crit) p.stats.crits++;
      if (hit) {
        const { dmg, dr } = rollDmg();
        let finalDmg = dmg;
        if (crit) finalDmg = dr.total * 2 + (dmg - dr.total);
        this.narrate(crit ? 'crit' : 'hit', { actor: e.name, target: target.name, dmg: finalDmg });
        this._applyDamage(target, finalDmg, e, { crit });
        this.actorEvent(e, '⚔️ 用' + used.name + '攻击' + target.name + '：命中，造成' + finalDmg + '点伤害' + (crit ? '（重击）' : ''), target);
        this.event('attack', { att: e.eid, def: target.eid, hit: true, dmg: finalDmg, crit });
        if (target.dead) this.narrate('kill', { actor: e.name, target: target.name });
      } else {
        p.stats.attacksMissed++;
        this.narrate(nat1 ? 'fumble' : 'miss', { actor: e.name, target: target.name });
        this.actorEvent(e, '⚔️ 用' + used.name + '攻击' + target.name + '：' + (nat1 ? '大失败！' : '未命中'), target);
        this.event('attack', { att: e.eid, def: target.eid, hit: false });
      }
    };
    if (p.sheet.class === 'fighter' && p.level >= 2) {
      doAttack();
      if (!target.dead && manhattan(e, target) <= used.range) doAttack({ adv: p._tactical ? 1 : 0 });
    } else {
      let adv = 0;
      if (p._tactical && p.charges.tactician > 0) { adv = 1; p.charges.tactician = 0; }
      doAttack({ adv });
    }
    if (p.sheet.class === 'fighter') p._tactical = false;
    return { ok: true };
  }
  _hasAllyAdjacent(target) {
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const e = this.entities.get(p.eid);
      if (e && !e.dead && manhattan(e, target) <= 1) return true;
    }
    return false;
  }

  actCast(pid, { spellId, targetEid, x, y }) {
    const p = this.players.get(pid);
    const t = this.turn;
    if (!p || !t || t.playerId !== pid) return { ok: false, msg: '不是你的回合' };
    const campG = this._campGuard(pid); if (campG) return campG; // F-30：营地休整中
    const e = this.entities.get(p.eid);
    if (!e || e.dead) return { ok: false, msg: '你无法行动' };
    const id = spellId.startsWith('s:') ? spellId.slice(2) : spellId.slice(2);
    const isSpell = spellId.startsWith('s:');
    const def = isSpell ? SPELLS[id] : FEATURES[id];
    if (!def) return { ok: false, msg: '未知技能' };
    if (def.bonusAction) {
      if (t.bonusUsed) return { ok: false, msg: '本回合已使用附赠动作' };
      t.bonusUsed = true;
    } else {
      if (t.actionUsed) return { ok: false, msg: '本回合已使用动作' };
      t.actionUsed = true;
    }
    // 消耗
    if (isSpell) {
      if (def.cost === 'slot') {
        if ((p.slots?.[1] || 0) <= 0) return { ok: false, msg: '没有可用法术位' };
        p.slots[1]--;
      }
      p.stats.spellsCast++;
    } else if (def.cost === 'chapter') {
      if ((p.charges[id] || 0) <= 0) return { ok: false, msg: '本章已使用过该能力' };
      p.charges[id] = 0;
      p.stats.spellsCast++;
    }
    const spellMod = p.sheet.mods[def.bonusAttr || p.sheet.mainAttr] || 0;
    const spellBonus = p.sheet.prof + spellMod;
    const dc = 8 + p.sheet.prof + spellMod;
    switch (def.kind) {
      case 'spellAttack': {
        const target = this.entities.get(targetEid);
        if (!target || target.dead || target.kind !== 'monster') return { ok: false, msg: '目标无效' };
        const r = d20();
        const total = r.total + spellBonus;
        const hit = r.total === 20 ? true : (r.total === 1 ? false : total >= target.ac);
        this.logMsg('dice', '🔮 ' + e.name + ' 施放' + def.name + '：d20=' + r.total + '+' + spellBonus + '=' + total + ' vs AC' + target.ac + '（' + (r.total === 20 ? '重击！' : r.total === 1 ? '大失败！' : hit ? '命中！' : '未命中') + '）', { imp: r.total === 20 || r.total === 1 ? 'key' : 'minor' });
        if (hit) {
          const d = roll(def.dice);
          let dmg = d.total + (p.level >= 3 && p.sheet.class === 'wizard' ? roll('1d4').total : 0);
          if (r.total === 20) dmg = d.total * 2;
          this._applyDamage(target, dmg, e, { type: def.type });
          this._multiHitCheck(e, 1);
          this.actorEvent(e, '🔮 施放' + def.name + '命中' + target.name + '，造成' + dmg + '点' + (def.type || '') + '伤害', target);
        } else {
          this.actorEvent(e, '🔮 施放' + def.name + '攻击' + target.name + '：未命中', target);
        }
        break;
      }
      case 'saveAttack': {
        const target = this.entities.get(targetEid);
        if (!target || target.dead || target.kind !== 'monster') return { ok: false, msg: '目标无效' };
        const r = d20();
        const mod = this._monsterSaveMod(target, def.save);
        const save = r.total + mod;
        const ok = save >= dc;
        this.logMsg('dice', '🔮 ' + e.name + ' 施放' + def.name + '：' + target.name + ' ' + def.save + '豁免 d20=' + r.total + '+' + mod + '=' + save + ' vs DC' + dc + (ok ? ' 成功！' : ' 失败！'));
        if (!ok) {
          let dmg = roll(def.dice).total + (p.level >= 3 && p.sheet.class === 'cleric' ? roll('1d8').total : 0);
          this._applyDamage(target, dmg, e, { type: def.type });
          this._multiHitCheck(e, 1);
          this.actorEvent(e, '🔮 施放' + def.name + '：' + target.name + '豁免失败，造成' + dmg + '点伤害', target);
        } else {
          this.actorEvent(e, '🔮 施放' + def.name + '：' + target.name + '豁免成功', target);
        }
        break;
      }
      case 'autoHit': {
        const target = this.entities.get(targetEid);
        if (!target || target.dead || target.kind !== 'monster') return { ok: false, msg: '目标无效' };
        const d = roll(def.dice);
        this.logMsg('dice', '✨ ' + e.name + ' 的' + def.name + '自动命中！伤害 ' + d.total);
        this._applyDamage(target, d.total, e, { type: def.type });
        this._multiHitCheck(e, 3);
        this.actorEvent(e, '✨ ' + def.name + '自动命中' + target.name + '，造成' + d.total + '点伤害', target);
        break;
      }
      case 'aoe': {
        const cx = x !== undefined ? x : (targetEid ? this.entities.get(targetEid)?.x : null);
        const cy = y !== undefined ? y : (targetEid ? this.entities.get(targetEid)?.y : null);
        if (cx === undefined || cy === undefined) return { ok: false, msg: '请选择目标区域' };
        const hits = [];
        for (const ent of this.entities.values()) {
          if (ent.dead || ent.kind !== 'monster') continue;
          if (Math.abs(ent.x - cx) <= 1 && Math.abs(ent.y - cy) <= 1) hits.push(ent);
        }
        if (!hits.length) return { ok: false, msg: '区域内没有敌人', undo: true };
        this.logMsg('dice', '💥 ' + e.name + ' 施放' + def.name + '！');
        for (const ent of hits) {
          const r = d20();
          const mod = this._monsterSaveMod(ent, def.save);
          const save = r.total + mod;
          const ok = save >= dc;
          const d = roll(def.dice);
          const dmg = ok ? Math.floor(d.total / 2) : d.total;
          this.logMsg('dice', '  → ' + ent.name + ' ' + def.save + '豁免 d20=' + r.total + '+' + mod + '=' + save + ' vs DC' + dc + (ok ? ' 成功，伤害减半 ' : ' 失败 ') + dmg + '点');
          this._applyDamage(ent, dmg, e, { type: def.type });
        }
        this._multiHitCheck(e, hits.length);
        this.actorEvent(e, '💥 施放' + def.name + '波及' + hits.length + '名敌人', hits[0]);
        break;
      }
      case 'heal': {
        const target = targetEid ? this.entities.get(targetEid) : e;
        if (!target || target.dead || target.kind !== 'player') return { ok: false, msg: '目标无效' };
        const d = roll(def.dice);
        const heal = d.total + (def.id === 'healingword' ? spellMod : 0) + (def.id === 'channeldivinity' ? spellMod : 0);
        this._heal(target, heal, e);
        this.actorEvent(e, '💖 施放' + def.name + '治疗' + target.name + '（+' + heal + '）', target);
        break;
      }
      case 'bless': {
        const targets = [...this.players.values()].filter(x => !x.dead).slice(0, 3);
        for (const tp of targets) {
          tp.blessed = true;
          this.addBuff(tp.pid, { id: 'bless', name: '祝福术', icon: '🙏', combatOnly: true }); // F-23：buff状态机
        }
        this.logMsg('dice', '🙏 ' + e.name + ' 施放祝福术：' + targets.map(x => x.name).join('、') + ' 的攻击+1d4');
        p.stats.healed += 0;
        this.actorEvent(e, '🙏 施放祝福术：' + targets.map(x => x.name).join('、') + '攻击+1d4');
        break;
      }
      case 'mark': {
        const target = this.entities.get(targetEid);
        if (!target || target.dead || target.kind !== 'monster') return { ok: false, msg: '目标无效' };
        p.mark = target.eid;
        this.addBuff(p.pid, { id: 'mark', name: '猎人印记', icon: '🎯', combatOnly: true }); // F-23：buff状态机
        this.logMsg('system', '🎯 ' + e.name + ' 标记了 ' + target.name + '（猎人印记）');
        this.actorEvent(e, '🎯 标记了' + target.name + '（猎人印记）', target);
        break;
      }
      case 'advantage': {
        p._tactical = true;
        this.logMsg('system', '🎖️ ' + e.name + ' 观察战场（下次攻击优势）');
        this.actorEvent(e, '🎖️ 观察战场（下次攻击优势）');
        break;
      }
    }
    return { ok: true };
  }

  _multiHitCheck(srcE, n) {
    if (srcE.kind !== 'player' || n < 3) return;
    const p = this.players.get(srcE.playerId);
    if (p) p.stats.maxMultiHit = Math.max(p.stats.maxMultiHit, n);
  }

  _heal(target, amount, srcE) {
    const p = this.players.get(target.playerId);
    if (!p) return;
    target.hp = clamp(target.hp + amount, 0, target.maxHp);
    p.stats.healed += amount;
    if (srcE && srcE.kind === 'player') {
      const sp = this.players.get(srcE.playerId);
      if (sp && sp.pid !== p.pid) sp.stats.healed += amount;
    }
    if (target.downed && target.hp > 0) { target.downed = false; p.downed = false; p.stable = false; p.deathSaves = { s: 0, f: 0 }; p.stats.rescues = p.stats.rescues || []; this.removeDebuff(p.pid, 'downed'); }
    this.narrate('heal', { actor: srcE ? srcE.name : target.name, target: target.name, hp: amount });
    this.director.flourish(this, 'heal', { actor: srcE ? srcE.name : target.name, target: target.name }); // S1-4：常规事件LLM加戏
    this.logMsg('system', '💖 ' + target.name + ' 恢复了 ' + amount + ' 点生命（' + target.hp + '/' + target.maxHp + '）');
    this.event('heal', { src: srcE ? srcE.eid : null, def: target.eid, amount });
  }

  actUseItem(pid, { itemId, targetEid }) {
    const p = this.players.get(pid);
    const t = this.turn;
    if (!p || !t || t.playerId !== pid) return { ok: false, msg: '不是你的回合' };
    const campG = this._campGuard(pid); if (campG) return campG; // F-30：营地休整中
    const e = this.entities.get(p.eid);
    if (!e || e.dead) return { ok: false, msg: '你无法行动' };
    const item = ITEMS[itemId];
    if (!item || (p.items[itemId] || 0) <= 0) return { ok: false, msg: '没有这个道具' };
    if (itemId === 'potion') {
      if (t.bonusUsed) return { ok: false, msg: '本回合已使用附赠动作' };
      t.bonusUsed = true;
      const target = targetEid ? this.entities.get(targetEid) : e;
      if (!target || target.dead || target.kind !== 'player') return { ok: false, msg: '目标无效' };
      const d = roll(item.heal);
      p.items.potion--;
      this._heal(target, d.total, e);
      this.actorEvent(e, '🧪 对' + target.name + '使用治疗药水（+' + d.total + '）', target);
    } else if (itemId === 'flask') {
      if (t.actionUsed) return { ok: false, msg: '本回合已使用动作' };
      t.actionUsed = true;
      const cx = targetEid ? this.entities.get(targetEid)?.x : undefined;
      const cy = targetEid ? this.entities.get(targetEid)?.y : undefined;
      if (cx === undefined) return { ok: false, msg: '请选择目标区域' };
      if (manhattan(e, { x: cx, y: cy }) > 8) return { ok: false, msg: '太远了（8格内）', undo: true };
      p.items.flask--;
      const dc = item.aoe.dc;
      this.logMsg('dice', '🧨 ' + e.name + ' 投掷炼金火焰瓶！');
      let hitAny = false;
      for (const ent of this.entities.values()) {
        if (ent.dead || ent.kind !== 'monster') continue;
        if (Math.abs(ent.x - cx) <= 1 && Math.abs(ent.y - cy) <= 1) {
          hitAny = true;
          const r = d20();
          const mod = this._monsterSaveMod(ent, 'DEX');
          const ok = r.total + mod >= dc;
          const d = roll(item.aoe.dmg);
          const dmg = ok ? Math.floor(d.total / 2) : d.total;
          this.logMsg('dice', '  → ' + ent.name + ' 敏捷豁免 ' + (ok ? '成功 ' : '失败 ') + dmg + '点火焰伤害');
          this._applyDamage(ent, dmg, e, { type: '火焰' });
        }
      }
      if (!hitAny) return { ok: false, msg: '区域内没有敌人', undo: true };
      this._multiHitCheck(e, 3);
      this.actorEvent(e, '🧨 投掷炼金火焰瓶');
    }
    return { ok: true };
  }

  actDash(pid) {
    const p = this.players.get(pid);
    const t = this.turn;
    if (!p || !t || t.playerId !== pid) return { ok: false, msg: '不是你的回合' };
    if (t.actionUsed) return { ok: false, msg: '本回合已使用动作' };
    const campG = this._campGuard(pid); if (campG) return campG; // F-30：营地休整中
    t.actionUsed = true;
    const e = this.entities.get(p.eid);
    t.moveLeft += e.speed;
    this.logMsg('system', '🏃 ' + e.name + ' 疾走！');
    this.actorEvent(e, '🏃 疾走（移动力+速度）');
    return { ok: true };
  }
  actHide(pid) {
    const p = this.players.get(pid);
    const t = this.turn;
    if (!p || !t || t.playerId !== pid) return { ok: false, msg: '不是你的回合' };
    const e = this.entities.get(p.eid);
    if (t.actionUsed) return { ok: false, msg: '本回合已使用动作' };
    const campG = this._campGuard(pid); if (campG) return campG; // F-30：营地休整中
    t.actionUsed = true;
    e.hidden = true;
    p.stats.usesHide++;
    this.logMsg('system', '🥷 ' + e.name + ' 躲藏了起来');
    this.actorEvent(e, '🥷 躲藏（潜行判定+5）');
    return { ok: true };
  }
  actSearch(pid) {
    const p = this.players.get(pid);
    const t = this.turn;
    if (!p || !t || t.playerId !== pid) return { ok: false, msg: '不是你的回合' };
    if (t.actionUsed) return { ok: false, msg: '本回合已使用动作' };
    const campG = this._campGuard(pid); if (campG) return campG; // F-30：营地休整中
    const e = this.entities.get(p.eid);
    t.actionUsed = true;
    p.stats.searches++;
    this.narrate('search', { actor: e.name });
    const r = d20();
    const mod = p.sheet.mods.INT + (p.sheet.skills.includes('investigation') ? p.sheet.prof : 0);
    const total = r.total + mod;
    this.logMsg('dice', '🔍 ' + e.name + ' 搜索：d20=' + r.total + '+' + mod + '=' + total);
    // 附近是否有可搜索物
    const prop = this.map.props?.find(pr => manhattan(e, pr) <= 2 && !this.searchedProps.has(this.chapter.id + ':' + pr.x + ':' + pr.y));
    if (prop) {
      this.searchedProps.add(this.chapter.id + ':' + prop.x + ':' + prop.y);
      const g = roll('2d6+5');
      p.gold += g.total; p.stats.goldEarned += g.total;
      const flavor = prop.type === 'barrel' ? '木桶夹层' : prop.type === 'rock' ? '石堆缝隙' : prop.type === 'crystal' ? '水晶簇下' : '角落里';
      this.narrate('found', { actor: e.name, item: g.total + '枚金币' });
      this.logMsg('system', '🔍 ' + flavor + '里藏着 ' + g.total + ' 金币！');
    } else if (total >= 15) {
      const g = roll('1d6');
      p.gold += g.total; p.stats.goldEarned += g.total;
      this.narrate('found', { actor: e.name, item: g.total + '枚金币' });
      this.logMsg('system', '🔍 你找到了 ' + g.total + ' 枚金币');
    } else {
      this.logMsg('system', '🔍 什么也没找到。');
    }
    return { ok: true };
  }
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

  actSay(pid, text) {
    const p = this.players.get(pid);
    if (!p || !text) return { ok: false };
    const clean = String(text).slice(0, 200);
    this.logMsg('chat', '💬 ' + p.name + '：' + clean, { speaker: p.pid });
    return { ok: true };
  }

  actEndTurn(pid) {
    // F-30：营地休整中结束回合=回到冒险
    if (this.camp?.active && this.camp.ownerPid === pid) return this.campLeave(pid);
    // 手动模式：怪物回合等待玩家确认推进
    if (this.turn?.kind === 'monster' && this._pendingMonster && this.room.mode === 'manual') {
      const run = this._pendingMonster;
      this._pendingMonster = null;
      run();
      return { ok: true };
    }
    if (!this.isPlayerTurn(pid)) return { ok: false, msg: '不是你的回合' };
    const e = this.entities.get(this.players.get(pid)?.eid);
    this.dialogues.delete(pid); // 结束回合时关闭进行中的对话
    if (e && this.combat.active) this.actorEvent(e, '⏭️ 结束回合'); // F-24：事件树
    this._endTurn();
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
