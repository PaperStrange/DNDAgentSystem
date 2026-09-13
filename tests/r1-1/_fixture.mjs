// R1-1 测试夹具：in-memory 假 game，直接调用真实导出的系统函数。
// 不启动服务器、不连 ws、不读 config/data、不调用 LLM。
import { installTurn } from '../../server/game/systems/turn.mjs';
import { installCombat } from '../../server/game/systems/combat.mjs';
import { installStealth } from '../../server/game/systems/stealth.mjs';
import { buildSheet } from '../../server/game/charsheet.mjs';

export function blankMap(w, h, { difficult = [] } = {}) {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push({ x, y, type: 'floor', blockMove: false, blockSight: false, difficult: difficult.some(d => d.x === x && d.y === y) });
    tiles.push(row);
  }
  return { w, h, tiles, props: [] };
}

export function sheetOf(cls, over = {}) {
  return buildSheet({
    name: 'T-' + cls, raceId: 'human', classId: cls,
    stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 },
    flex: { CON: 1 }, ...over,
  });
}

export const BASE_STATS = () => ({
  damageDealt: 0, damageTaken: 0, healed: 0, kills: 0, lastHits: 0, crits: 0,
  attacksMissed: 0, spellsCast: 0, maxMultiHit: 0, goldEarned: 0, searches: 0, usesHide: 0,
});

/**
 * 构造一个最小可用的假 game：装配真实的 turn/combat/stealth 系统，
 * 再把会产生外部副作用的方法替换成记录型 spy（_applyDamage/_endTurn/_alertSquad 等）。
 * 需要真实实现的用例可用 g.__real.xxx 取回。
 */
export function makeGame(opts = {}) {
  const g = {};
  g.entities = new Map();
  g.players = new Map();
  g.seatOrder = [];
  g.state = 'playing';
  g.room = { mode: opts.mode || 'auto' };
  g.map = opts.map || blankMap(opts.w || 12, opts.h || 12, opts);
  g.combat = { active: false, round: 0, order: [], idx: 0, squads: new Set() };
  g.combatEvents = [];
  g.eventTrees = new Map();
  g.combatCount = 0;
  g.pendingBoss = null;
  g.bossRevealCd = 0;
  g.lastCamp = null;
  g.wanderTimer = null;
  g.turn = null;
  g.turnTimer = null;
  g.camp = null;
  g.paused = false;
  g.closed = false;
  g.win = false;
  g.speed = 1;
  g.seq = 0;
  g.seqNext = () => ++g.seq;
  g.chapter = { id: 'test', idx: 0 };
  g.deadSquads = new Set();
  g.searchedProps = new Set();
  g.dialogues = new Map();
  g.keys = new Set();
  g.flags = new Set();
  g.xpPool = 0;

  // ---- 记录器 ----
  g.calls = {
    log: [], narrate: [], damage: [], heal: [], alertSquad: [], openBossVote: [],
    startPlayerTurn: [], scheduleMonsterTurn: [], performAttack: [], fleeToCamp: [],
    endTurn: 0, onChange: 0, visionCheck: 0,
  };

  // ---- 装配真实系统 ----
  installCombat(g);
  installTurn(g);
  installStealth(g);

  // ---- 保留真实实现（绑定 this，便于用例直接调用），然后默认换成 spy ----
  g.__real = {
    _alertSquad: g._alertSquad.bind(g),
    _endTurn: g._endTurn.bind(g),
    _startPlayerTurn: g._startPlayerTurn.bind(g),
    _scheduleMonsterTurn: g._scheduleMonsterTurn.bind(g),
    _performAttack: g._performAttack.bind(g),
    _monsterAct: g._monsterAct.bind(g),
    _fleeToCamp: g._fleeToCamp.bind(g),
    _startBossCombat: g._startBossCombat.bind(g),
    _resolveBossFlee: g._resolveBossFlee.bind(g),
  };

  // ---- 无副作用桩（必须在 install 之后赋值：install* 会覆盖同名方法）----
  g.logMsg = (...a) => { g.calls.log.push(a.map(x => (typeof x === 'string' ? x : '')).join(' ')); };
  g.narrate = (k, d) => { g.calls.narrate.push({ k, d }); };
  g.onChange = () => { g.calls.onChange++; };
  g.event = () => {};
  g.director = { flourish() {}, noteCombat() {}, noteEncounterEnd() {} };
  g.later = (_ms, fn) => setTimeout(fn, 0);
  g.isPlayerOnline = () => true;
  g.addBuff = () => {};
  g.removeBuff = () => {};
  g.addDebuff = () => {};
  g.removeDebuff = () => {};
  g.addClue = () => {};
  g._campGuard = () => null;
  g._enterCombatState = () => {};
  g._exitCombatState = () => {};
  g._visionCheck = () => { g.calls.visionCheck++; };
  g._monsterSaveMod = () => 0;
  g._applyDamage = (def, dmg) => {
    g.calls.damage.push({ eid: def.eid, dmg });
    def.hp -= dmg;
    if (def.hp <= 0) { def.hp = 0; def.dead = true; }
  };
  g._heal = (t, amt) => { g.calls.heal.push({ eid: t.eid, amt }); t.hp = Math.min(t.maxHp, t.hp + amt); };
  g.entitiesAt = function (x, y) {
    const out = [];
    for (const e of this.entities.values()) if (e.x === x && e.y === y && !e.dead) out.push(e);
    return out;
  };
  g.pathMap = function (forPlayer = true) {
    return {
      w: this.map.w, h: this.map.h, tiles: this.map.tiles,
      _entityAt: (x, y) => {
        const list = this.entitiesAt(x, y);
        if (!list.length) return null;
        if (forPlayer) return list.find(e => e.kind === 'monster') || null;
        return list[0];
      },
    };
  };
  g.wanderTimer = null;
  g.pendingBoss = null;
  g.bossRevealCd = 0;
  g._alertSquad = (m, o) => { g.calls.alertSquad.push({ eid: m && m.eid, opts: o }); };
  g._openBossVote = (boss, spotter) => { g.calls.openBossVote.push({ bossEid: boss && boss.eid, spotterEid: spotter && spotter.eid }); };
  g._endTurn = () => { g.calls.endTurn++; };
  g._startPlayerTurn = (pid) => { g.calls.startPlayerTurn.push(pid); };
  g._scheduleMonsterTurn = (eid) => { g.calls.scheduleMonsterTurn.push(eid); };
  g._performAttack = (att, def, atk) => { g.calls.performAttack.push({ attEid: att && att.eid, defEid: def && def.eid, atkName: atk && atk.name }); };
  g._fleeToCamp = () => { g.calls.fleeToCamp.push(true); };

  // ---- 实体/玩家构造 ----
  g.addPlayer = function ({ pid = 'p1', cls = 'fighter', x = 0, y = 0, level = 1, items = {}, slots = {}, charges = {}, speed } = {}) {
    const sheet = sheetOf(cls);
    const p = {
      pid, name: sheet.name, sheet, level, eid: 'e_' + pid, dead: false, downed: false, stable: false,
      deathSaves: { s: 0, f: 0 }, items: { potion: 0, flask: 0, ...items }, slots: { 1: 0, ...slots },
      charges: { ...charges }, _lastCharge: null, stats: BASE_STATS(), gold: 0, xp: 0, mark: null, blessed: false,
      halflingReroll: false, hiddenThisRound: false,
    };
    this.players.set(pid, p);
    this.seatOrder.push(pid);
    const e = {
      eid: p.eid, kind: 'player', name: sheet.name, x, y, hp: sheet.hp, maxHp: sheet.maxHp, ac: sheet.ac,
      speed: speed === undefined ? sheet.speed : speed, playerId: pid, level, dead: false, downed: false,
      dex: sheet.stats.DEX, vision: 8, stats: sheet.stats, mods: sheet.mods, hidden: false,
    };
    this.entities.set(e.eid, e);
    return { p, e };
  };

  g.addMonster = function ({ eid = 'm1', name = '怪物', x = 0, y = 0, squad = 'sq1', hp = 20, ac = 12, speed = 6, attacks = [{ name: '爪击', range: 1, bonus: 3, dmg: '1d4' }], boss = false, alert = 'calm', defKey = 'goblin' } = {}) {
    const e = { eid, kind: 'monster', name, defKey, x, y, hp, maxHp: hp, ac, speed, squad, dead: false, downed: false, hp0: false, boss, alert, lastSeen: null, attacks, dex: 10, size: 1 };
    this.entities.set(eid, e);
    return e;
  };

  g.startTurn = function (pid, over = {}) {
    const p = this.players.get(pid);
    const e = this.entities.get(p.eid);
    this.turn = { actorEid: e.eid, playerId: pid, kind: 'player', moveLeft: e.speed, actionUsed: false, bonusUsed: false, round: 0, ...over };
    return this.turn;
  };

  return g;
}
