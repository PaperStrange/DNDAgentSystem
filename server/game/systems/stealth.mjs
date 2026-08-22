// 视野与游荡系统（F-29/F-31）：
// - 怪物视野（vision半径，BOSS=无限大）；暴露状态机：calm绿(未暴露) → suspicious橙(察觉未暴露) → exposed红(已暴露)
// - 察觉判定（5E察觉 vs 潜行）：暴露→立即进入战斗；察觉失败→橙，朝玩家最后出现方向行动，途中概率主动发现
// - 冒险状态下除BOSS外怪物随机游荡，与玩家行动相互独立；进入战斗后双方严格回合制（游荡停止）
import { manhattan, losClear, findPath, d20, rnd } from '../../util.mjs';

export function installStealth(game) {
  game.wanderTimer = null;
  game.pendingBoss = null; // {bossEid, votes: Map(pid->agree|flee)}
  game.bossRevealCd = 0;
  game.lastCamp = null; // {chapterIdx, x, y} 上一个营地（F-30逃跑落点）

  game.visionOf = function (m) {
    if (m.boss) return Infinity; // F-30：BOSS视野默认无限大
    return m.vision || 8;
  };

  // 玩家潜行基准（5E：察觉 vs 潜行；躲藏+5）
  game._playerStealth = function (pe) {
    const p = this.players.get(pe.playerId);
    if (!p) return 10;
    let v = 10 + (p.sheet.mods?.DEX || 0);
    if (p.sheet.skills?.includes('stealth')) v += p.sheet.prof || 2;
    if (pe.hidden) v += 5;
    return v;
  };
  game._monsterPerception = function (m) {
    return 10; // 5E被动察觉基准（新手套组常见怪物察觉10）
  };

  // 怪物当前是否看见某玩家（视野内+LOS；BOSS无限视野）
  game._canSee = function (m, pe) {
    if (!pe || pe.dead || pe.hp <= 0) return false;
    const v = this.visionOf(m);
    if (!isFinite(v)) return true;
    if (manhattan(m, pe) > v) return false;
    return losClear(this.pathMap(false), m, pe);
  };

  // 察觉掷骰：成功→暴露(红)并开战；失败→察觉但未暴露(橙)，记录最后出现位置
  game._spotPlayer = function (m, pe) {
    if (m.alert === 'exposed') return true;
    const r = d20();
    const dc = this._playerStealth(pe);
    const total = r.total + this._monsterPerception(m);
    if (r.total === 20 || total >= dc) {
      m.alert = 'exposed';
      m.lastSeen = { x: pe.x, y: pe.y };
      this.logMsg('state', '👁️ ' + m.name + ' 发现了 ' + pe.name + '（察觉 d20=' + r.total + '+10 vs 潜行' + dc + '）——暴露！');
      return true;
    }
    if (m.alert !== 'suspicious') {
      m.alert = 'suspicious';
      m.lastSeen = { x: pe.x, y: pe.y };
      this.logMsg('state', '👁️ ' + m.name + ' 似乎察觉到了什么，朝 ' + pe.name + ' 最后出现的方向张望…');
    }
    return false;
  };

  // 视野检测（玩家移动/回合开始触发）：普通怪物直接开战；BOSS走发现→表决流程
  game._visionCheck = function () {
    if (this.state !== 'playing' || this.combat.active || this.camp?.active || this.pendingBoss || this.win) return;
    this._bossRevealCheck();
    if (this.pendingBoss || this.combat.active) return;
    for (const m of this._aliveEnemies()) {
      if (m.boss) continue; // BOSS由_revealBossCheck处理（无限视野+全队表决）
      for (const [pid, p] of this.players) {
        if (p.dead) continue;
        const pe = this.entities.get(p.eid);
        if (!pe) continue;
        if (!this._canSee(m, pe)) continue;
        if (this._spotPlayer(m, pe)) { this._alertSquad(m); return; }
      }
    }
  };

  // BOSS发现：任一存活玩家LOS≤16格看到BOSS（BOSS视野无限→双方互相暴露；16>最长武器射程15，
  // 保证先进入遭遇表决、再谈开战——不会被远程武器直接偷袭跳过表决）→ 全队表决开战
  game._openBossVote = function (boss, spotter) {
    boss.alert = 'exposed';
    boss.lastSeen = { x: spotter.x, y: spotter.y };
    this.pendingBoss = { bossEid: boss.eid, votes: new Map(), startedAt: Date.now() };
    this.logMsg('combat', '👑 ' + boss.name + ' 察觉到了你们！它的视野无限——战斗一触即发（全队表决：开战或逃跑）。');
    this.narrate('bossSpotted', { actor: boss.name });
    this.onChange();
  };
  game._bossRevealCheck = function () {
    if (this.state !== 'playing' || this.combat.active || this.pendingBoss || this.camp?.active || this.win) return;
    if (this.bossRevealCd && Date.now() < this.bossRevealCd) return;
    const boss = [...this.entities.values()].find(e => e.kind === 'monster' && e.boss && !e.dead);
    if (!boss) return;
    const pm = this.pathMap(false);
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const pe = this.entities.get(p.eid);
      if (!pe || pe.dead) continue;
      if (manhattan(pe, boss) <= 16 && losClear(pm, pe, boss)) {
        this._openBossVote(boss, pe);
        return;
      }
    }
  };

  // F-30：BOSS遭遇表决。全员同意→开战；任一人选逃跑→立即掷骰（≥11成功）
  game.bossVote = function (pid, vote) {
    const pb = this.pendingBoss;
    if (!pb) return { ok: false, msg: '当前没有需要表决的BOSS遭遇' };
    if (pb.votes.has(pid)) return { ok: false, msg: '你已经表决过了' };
    const v = vote === 'flee' ? 'flee' : 'agree';
    pb.votes.set(pid, v);
    const p = this.players.get(pid);
    this.logMsg('system', '🗳️ ' + (p?.name || pid) + (v === 'flee' ? ' 提议逃跑' : ' 同意开战') + '（' + [...pb.votes.values()].filter(x => x === 'agree').length + '同意/' + [...pb.votes.values()].filter(x => x === 'flee').length + '逃跑）');
    if (v === 'flee') return this._resolveBossFlee();
    const alive = [...this.players.values()].filter(x => !x.dead);
    // 离线玩家不阻塞表决（掉线窗口内默认视为弃权跟随多数）
    if (alive.every(x => pb.votes.get(x.pid) === 'agree' || !this.isPlayerOnline(x.pid))) this._startBossCombat();
    return { ok: true };
  };

  game._resolveBossFlee = function () {
    const pb = this.pendingBoss;
    const boss = this.entities.get(pb?.bossEid);
    this.pendingBoss = null;
    const r = d20();
    if (r.total >= 11) { // 50%概率逃跑成功
      this.logMsg('dice', '🏃 逃跑掷骰：d20=' + r.total + '（需≥11）——成功！你们甩掉了' + (boss?.name || 'BOSS') + '。');
      this.narrate('fleeSuccess', {});
      this._fleeToCamp();
      return { ok: true, fled: true };
    }
    this.logMsg('dice', '🏃 逃跑掷骰：d20=' + r.total + '（需≥11）——失败！' + (boss?.name || 'BOSS') + ' 拦住了去路！');
    this._startBossCombat();
    return { ok: true, fled: false };
  };

  game._startBossCombat = function () {
    const pb = this.pendingBoss;
    const boss = this.entities.get(pb?.bossEid);
    this.pendingBoss = null;
    this.bossRevealCd = Date.now() + 20000;
    if (!boss || boss.dead) return;
    this._alertSquad(boss, { bossFight: true });
  };

  // 逃跑成功：全队传送回上一个营地（无营地记录→本章出生点）
  game._fleeToCamp = function () {
    this.bossRevealCd = Date.now() + 20000;
    const boss = [...this.entities.values()].find(e => e.kind === 'monster' && e.boss && !e.dead);
    if (boss) { boss.alert = 'calm'; boss.lastSeen = null; }
    if (this.lastCamp && this.lastCamp.chapterIdx !== this.chapterIdx) {
      this._loadChapter(this.lastCamp.chapterIdx);
    }
    const loc = this.lastCamp || null;
    const pts = this._campSpots(loc ? { x: loc.x, y: loc.y } : { x: 1, y: 1 });
    let i = 0;
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const e = this.entities.get(p.eid);
      if (!e) continue;
      const pt = pts[i % pts.length]; i++;
      e.x = pt.x; e.y = pt.y;
    }
    this.logMsg('system', '🏕️ 你们被传送回了上一个营地。');
    if (!this.combat.active) { this.turn = null; this._startFirstTurn(); }
    this.onChange();
  };

  // 营地/出生点周围的落脚位置
  game._campSpots = function (loc) {
    const out = [];
    for (const [dx, dy] of [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [2, 1], [-2, 1], [2, 0], [-2, 0]]) {
      const x = loc.x + dx, y = loc.y + dy;
      if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) continue;
      const t = this.map.tiles[y][x];
      if (t && !t.blockMove && !this.entitiesAt(x, y).length) out.push({ x, y });
    }
    if (!out.length) out.push({ x: loc.x, y: loc.y });
    return out;
  };

  // ---------- 游荡（F-31） ----------
  game._startWander = function () {
    if (this.wanderTimer) return;
    this.wanderTimer = setInterval(() => {
      if (this.closed) { clearInterval(this.wanderTimer); this.wanderTimer = null; return; }
      if (this.state !== 'playing' || this.combat.active || this.camp?.active || this.pendingBoss || this.win) return;
      try { this._wanderTick(); } catch (e) { /* 防御 */ }
    }, 2200);
  };
  game._stopWander = function () {
    if (this.wanderTimer) { clearInterval(this.wanderTimer); this.wanderTimer = null; }
  };

  game._wanderTick = function () {
    this._bossRevealCheck();
    if (this.combat.active || this.pendingBoss) return;
    for (const m of this._aliveEnemies()) {
      if (m.boss) continue; // BOSS不游荡（视野无限，镇守领地）
      this._monsterWanderStep(m);
      if (this.combat.active) return;
    }
  };

  game._monsterWanderStep = function (m) {
    // 1) 视野内有人 → 察觉判定（有概率主动发现）
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const pe = this.entities.get(p.eid);
      if (!pe || pe.dead) continue;
      if (this._canSee(m, pe) && this._spotPlayer(m, pe)) { this._alertSquad(m); return; }
    }
    // 2) 橙（察觉但未暴露）：朝玩家最后出现方向行动
    if (m.alert === 'suspicious' && m.lastSeen) {
      const arrived = m.x === m.lastSeen.x && m.y === m.lastSeen.y;
      if (!arrived) {
        const step = findPath(this.pathMap(false), m, m.lastSeen, 1, { passEntities: false, ignoreEntityId: m.eid })[0];
        if (step) { m.x = step.x; m.y = step.y; }
        else { m.alert = 'calm'; m.lastSeen = null; } // 无路可走：放弃追踪
      } else if (rnd() < 0.3) {
        m.alert = 'calm'; m.lastSeen = null;
        this.logMsg('state', '👁️ ' + m.name + ' 在最后出现的位置一无所获，重新放松了警惕。');
      }
      // 途中再次扫视（概率主动发现玩家）
      for (const [pid, p] of this.players) {
        if (p.dead) continue;
        const pe = this.entities.get(p.eid);
        if (!pe || pe.dead) continue;
        if (this._canSee(m, pe) && this._spotPlayer(m, pe)) { this._alertSquad(m); return; }
      }
      this.onChange();
      return;
    }
    // 3) 绿（未暴露）：随机游荡（50%概率原地停留）
    if (rnd() < 0.5) return;
    const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }))
      .filter(pt => this._wanderable(pt.x, pt.y, m));
    if (!opts.length) return;
    const to = opts[Math.floor(rnd() * opts.length)];
    m.x = to.x; m.y = to.y;
    this.onChange();
  };

  game._wanderable = function (x, y, m) {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return false;
    const t = this.map.tiles[y][x];
    if (!t || t.blockMove) return false;
    const list = this.entitiesAt(x, y);
    return !list.some(e => e.eid !== m.eid);
  };
}
