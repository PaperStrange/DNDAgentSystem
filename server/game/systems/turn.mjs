// 回合系统（S2-5 架构迁移）：回合状态机与玩家动作，自 game.mjs 原样迁出，行为零变更

import { ITEMS } from '../dungeon.mjs';
import { roll, d20, clamp, findPath, losClear, manhattan } from '../../util.mjs';

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
  huntermark2: { id: 'huntermark2', name: '猎人印记', icon: '🎯', kind: 'mark', range: 10, cost: 'combat', bonusAction: true, desc: '附赠动作：标记敌人，对其伤害+1d6（每场战斗1次）' },
};

export function installTurn(game) {
  game._startFirstTurn = function () {
    const pid = this.seatOrder.find(id => this.players.get(id) && !this.players.get(id).dead);
    if (pid === undefined) return this._endGame('defeat', '没有可行动的玩家');
    this._startPlayerTurn(pid);
  }

  game._startPlayerTurn = function (pid) {
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

  game._endTurn = function () {
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

  game._nextActor = function () {
    if (!this.combat.active || !this.combat.order.length) return null;
    if (this.combat.idx >= this.combat.order.length) this.combat.idx = 0;
    const eid = this.combat.order[this.combat.idx];
    const e = this.entities.get(eid);
    if (!e || e.dead || e.hp <= 0) return null;
    return e;
  }

  game._nextSeatTurn = function (fromPid) {
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

  game.playerAttacks = function (p) {
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

  game.bonusAttacks = function (p) {
    const list = [];
    for (const sid of p.sheet.spells || []) { const sp = SPELLS[sid]; if (sp && sp.bonusAction) list.push({ ...sp, id: 's:' + sid }); }
    if (p.sheet.class === 'ranger') list.push({ ...FEATURES.huntermark2, id: 'f:huntermark2' });
    return list;
  }

  game.hasSlot = function (p, cost) {
    if (cost === 'cantrip') return true;
    if (cost === 'slot') return (p.slots?.[1] || 0) > 0;
    if (cost === 'chapter') return (p.charges?.[p._lastCharge] || 0) > 0;
    if (cost === 'combat') return true;
    if (cost === 'special') return true;
    return true;
  }

  game.actMove = function (pid, { x, y }) {
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

  game.actAttack = function (pid, { targetEid }) {
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

  game._hasAllyAdjacent = function (target) {
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const e = this.entities.get(p.eid);
      if (e && !e.dead && manhattan(e, target) <= 1) return true;
    }
    return false;
  }

  game.actCast = function (pid, { spellId, targetEid, x, y }) {
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

  game._multiHitCheck = function (srcE, n) {
    if (srcE.kind !== 'player' || n < 3) return;
    const p = this.players.get(srcE.playerId);
    if (p) p.stats.maxMultiHit = Math.max(p.stats.maxMultiHit, n);
  }

  game.actUseItem = function (pid, { itemId, targetEid }) {
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

  game.actDash = function (pid) {
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

  game.actHide = function (pid) {
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

  game.actSearch = function (pid) {
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

  game.actSay = function (pid, text) {
    const p = this.players.get(pid);
    if (!p || !text) return { ok: false };
    const clean = String(text).slice(0, 200);
    this.logMsg('chat', '💬 ' + p.name + '：' + clean, { speaker: p.pid });
    return { ok: true };
  }

  game.actEndTurn = function (pid) {
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

}
