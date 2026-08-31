// 进度系统（架构迁移）：升级/休息/章节目标/出口传送——角色成长与剧情推进与回合引擎解耦
// F-30：短休改为进入营地界面（营地休整/恢复/购买见 systems/camp.mjs）
export function installProgress(game) {
  game._levelUp = function (p, level) {
    p.level = level;
    const s = p.sheet;
    s.maxHp = s.hitDie + s.mods.CON + (s.race === 'dwarf' ? 1 : 0) + (level - 1) * (s.hpPerLv + s.mods.CON + (s.race === 'dwarf' ? 1 : 0));
    s.hp = s.maxHp;
    if (level === 2 && (s.class === 'wizard' || s.class === 'cleric')) p.slots = { 1: 3 };
    const e = this.entities.get(p.eid);
    if (e) { e.hp = s.maxHp; e.maxHp = s.maxHp; e.level = level; }
    const newFeats = s.features.filter(f => f.lv > 1 && f.lv <= level).map(f => f.name);
    this.narrate('levelUp', { actor: s.name, n: level }, { imp: 'key' });
    if (newFeats.length) this.logMsg('system', '✨ ' + s.name + ' 获得新特性：' + newFeats.join('、'));
  };

  game.actShortRest = function (pid) {
    const p = this.players.get(pid);
    const t = this.turn;
    if (!p || !t || t.playerId !== pid) return { ok: false, msg: '不是你的回合' };
    if (this.combat.active) return { ok: false, msg: '战斗中无法休息' }; // F-30：战斗中无法进入短休
    if (this.camp?.active) return { ok: false, msg: '队伍已在营地中' };
    if (t.actionUsed) return { ok: false, msg: '本回合已使用动作' };
    if ((p.charges.shortrest || 0) <= 0) return { ok: false, msg: '本章的短休次数已用完' };
    t.actionUsed = true;
    // F-30：短休不再立即恢复生命值，而是进入营地界面（篝火围坐；恢复生命/购买商品/回到冒险）
    return this.enterCamp(pid);
  };

  game._checkChapterObjective = function () {
    const obj = this.chapter.objective;
    if (!obj || this.flags.has('obj:' + obj.id)) return;
    let done = false;
    if (obj.id === 'rescue_sildar') done = this.flags.has('rescue_sildar');
    if (obj.id === 'defeat_glasstaff') done = [...this.entities.values()].some(e => e.defKey === 'glasstaff' && e.dead);
    if (obj.id === 'rescue_gundren') done = this.flags.has('rescue_gundren');
    if (obj.id === 'clear_ambush') done = this.deadSquads.has(this.chapter.id + ':ambush');
    if (obj.id === 'beat_nezznar') done = this.flags.has('nezznar_dead');
    if (done) {
      this.flags.add('obj:' + obj.id);
      this.addClue(obj.doneHint);
      this.logMsg('system', '✅ 章节目标达成：' + obj.text);
      this.narrate('goalAssign', { goal: obj.doneHint });
      this.logMsg('narr', obj.doneHint, { dm: true });
    }
  };

  game._tryTravel = function (targetExit, p) {
    const need = targetExit.need;
    if (need && !this.flags.has(need) && !this.flags.has('obj:' + need)) {
      this.logMsg('system', '🚧 出口未解锁：' + (need === 'town_info' ? '你们还需要更多凡达林镇的情报。' : '先完成当前目标。'));
      return { ok: false, msg: '出口未解锁' };
    }
    if (targetExit.to === null || targetExit.interact === 'forge') {
      if (this.flags.has('nezznar_dead')) return { ok: false, msg: '冒险已经结束了' };
      this.logMsg('system', '🔮 法术熔炉散发着幽光。击败黑蜘蛛后，它才会真正苏醒。');
      return { ok: false, msg: '还不是时候' };
    }
    const nextIdx = this.dungeon.chapters.findIndex(c => c.id === targetExit.to);
    if (nextIdx < 0) return { ok: false, msg: '未知地点' };
    const forward = nextIdx > this.chapterIdx;
    const wasBossChapter = this.chapter.boss && this.flags.has('obj:' + this.chapter.objective?.id);
    // F-32：按上一章节玩家表现，AI DM调整下一章难度（离线公式立即应用，LLM异步精调热更新）
    const perf = this._chapterPerformance();
    if (forward) this._scheduleChapterAdjust(nextIdx, perf);
    this.narrate('travel', { place: this.dungeon.chapters[nextIdx].place });
    this.logMsg('system', '🚶 队伍前往：' + this.dungeon.chapters[nextIdx].place);
    this._loadChapter(nextIdx);
    const ch = this.chapter;
    this.logMsg('system', '━━━ ' + ch.name + ' ━━━');
    this.narrate('chapterStart', { n: nextIdx, place: ch.place });
    this.logMsg('narr', ch.intro, { dm: true });
    this.logMsg('system', '🎯 ' + ch.objective.text + (ch.objective.isPublic ? '（公开目标！）' : ''));
    for (const [pid, pl] of this.players) pl.charges.shortrest = 2;
    for (const [pid, pl] of this.players) pl.charges.longrest = 1;
    if (!this.combat.active) { this.turn = null; this._startFirstTurn(); }
    this.onChange();
    return { ok: true, traveled: true };
  };
}
