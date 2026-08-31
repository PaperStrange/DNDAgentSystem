// 战斗系统（S2-5 架构迁移）：先攻轮序/小队警戒/怪物行动/攻击结算/伤害与击杀/事件树记录，自 game.mjs 原样迁出，行为零变更

import { MONSTERS } from '../dungeon.mjs';
import { roll, d20, clamp, findPath, losClear, manhattan } from '../../util.mjs';

export function installCombat(game) {
  game.actorEvent = function (actorE, text, targetE = null) {
    if (!this.combat.active) return;
    const ev = { seq: this.seqNext(), round: this.combat.round || 1, actorEid: actorE?.eid || null, actorName: actorE?.name || '', targetEid: targetE?.eid || null, targetName: targetE?.name || '', text, ts: Date.now() };
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

  game._aliveEnemies = function () {
    return [...this.entities.values()].filter(e => e.kind === 'monster' && !e.dead);
  }

  game._dexOf = function (e) {
    if (e.kind === 'player') {
      const p = this.players.get(e.playerId);
      return p?.sheet?.stats?.DEX ?? 10;
    }
    return e.dex ?? MONSTERS[e.defKey]?.dex ?? 10;
  }

  // F-25：阵营敏捷比较——先攻顺序构建。同一阵营敏捷高者先动；玩家先动时团队打头，否则敏捷高的一方先动（平局团队先动）
  game._buildCombatOrder = function (playerEs, monsterEs, playersFirst) {
    const byDex = (list) => list.slice().sort((a, b) => (this._dexOf(b) - this._dexOf(a)) || a.eid.localeCompare(b.eid));
    const ps = byDex(playerEs), ms = byDex(monsterEs);
    if (playersFirst) return [...ps, ...ms];
    const pMax = ps.length ? Math.max(...ps.map(e => this._dexOf(e))) : -Infinity;
    const mMax = ms.length ? Math.max(...ms.map(e => this._dexOf(e))) : -Infinity;
    return pMax >= mMax ? [...ps, ...ms] : [...ms, ...ps];
  }

  game._alertSquad = function (m, opts = {}) {
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

  game._endCombat = function () {
    this.director.noteEncounterEnd(this); // S1-4：战斗数据重置前快照战况，胜负旁白摘要用
    this.combat = { active: false, round: 0, order: [], idx: 0 };
    for (const [pid, p] of this.players) { p.blessed = false; p.mark = null; this.removeBuff(pid, 'bless'); this.removeBuff(pid, 'mark'); }
    this._exitCombatState(); // F-23：战斗结束→团队与全员回到「冒险中」
    this.logMsg('combat', '━━━ 🏳️ 战斗结束 ━━━', { imp: 'key' });
    this._checkSquadDead();
  }

  game._checkSquadDead = function () {
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

  game._scheduleMonsterTurn = function (eid) {
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

  game._monsterAct = function (e) {
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

  game._performAttack = function (att, def, atk, opts = {}) {
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

  game._monsterSaveMod = function (e, attr) {
    if (e.kind === 'player') {
      const p = this.players.get(e.playerId);
      return p.sheet.mods[attr] || 0;
    }
    const m = MONSTERS[e.defKey];
    if (m.saves && m.saves[attr] !== undefined) return m.saves[attr];
    return e.boss ? 2 : 1;
  }

  game._applyDamage = function (def, dmg, src, { type = '物理', crit = false } = {}) {
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

  game._killMonster = function (e, killer) {
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

  game._downPlayer = function (e) {
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

  game._killPlayer = function (p) {
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

  game._checkTpk = function () {
    if (this.state !== 'playing') return;
    const alive = [...this.players.values()].filter(p => !p.dead);
    if (!alive.length) return this._endGame('defeat', '队伍全员倒下，冒险失败');
    const anyStanding = alive.some(p => { const e = this.entities.get(p.eid); return e && !e.dead && !e.downed; });
    if (!anyStanding) this._endGame('defeat', '队伍全员倒下，冒险失败');
  }

  game._checkPublicWin = function () {
    if (this.state !== 'playing') return;
    if (this.chapter.id !== 'cave') return;
    const boss = [...this.entities.values()].find(e => e.finalBoss);
    if (boss && boss.dead) {
      this.flags.add('nezznar_dead');
      this._endGame('public', '黑蜘蛛涅兹纳尔被击败，法术熔炉之光重新亮起！');
    }
  }

  game._heal = function (target, amount, srcE) {
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

}
