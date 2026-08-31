// 游戏状态机：章节/地图/实体/回合/战斗/法术/道具/对话/胜负
import { parseMap, DUNGEONS, MONSTERS } from './dungeon.mjs';
import { installEntities } from './entities.mjs';
import { installDialogue } from './systems/dialogue.mjs';
import { installProgress } from './systems/progress.mjs';
import { installStates } from './systems/states.mjs';
import { installStealth } from './systems/stealth.mjs';
import { installCamp } from './systems/camp.mjs';
import { installTuning } from './systems/tuning.mjs';

// 升级经验需求表（按当前等级索引）：显示给玩家的具体数量；章节等级上限仍按 levelUpTo 控制节奏
export const XP_NEED = [0, 120, 350, 650];

let SEQ = 1;

import { installTurn } from './systems/turn.mjs';
import { installCombat } from './systems/combat.mjs';
import { installGoals } from './systems/goals.mjs';
import { installSnapshot } from './systems/snapshot.mjs';
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
    installSnapshot(this);
    installGoals(this);
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

  // ---------- 战斗 ----------

  // ---------- 攻击结算 ----------

  // ---------- 玩家动作 ----------
  getPlayer(pid) { return this.players.get(pid); }
  isPlayerTurn(pid) { return this.turn && this.turn.playerId === pid && this.state === 'playing'; }

  // ---------- 结束 ----------
  _endGame(kind, reason) {
    if (this.state !== 'playing') return;
    this.state = 'ended';
    this._stopWander(); // F-31：冒险结束停止游荡
    this.win = { kind, reason, at: Date.now(), duration: Date.now() - this.startedAt };
    this.logMsg('system', '━━━ 🎉 冒险结束 ━━━');
    this._verifyPendingGoals(); // S2-5：隐藏目标结算判定（见 systems/goals.mjs）
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
}
