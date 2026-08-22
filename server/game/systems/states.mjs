// 状态机系统（F-23）：玩家状态与团队状态单独维护
// 玩家状态：存活(dead)/倒地(downed)、战斗中(combat)、冒险中、buff组、debuff组
// 团队状态：adventuring(冒险中) | combat(战斗中) | camp(营地)——
//   只有与怪物遭遇后团队与全体玩家才进入「战斗中」，其余时间默认「冒险中」
// 状态转移带日志记录（logMsg kind=state），供事件树与排查使用
export function installStates(game) {
  game.teamState = 'adventuring'; // 'adventuring' | 'combat' | 'camp'

  game._playerState = function (p) {
    if (!p.state) {
      p.state = { combat: false, buffs: [], debuffs: [] };
    }
    return p.state;
  };

  game.setTeamState = function (next, reason = '') {
    if (this.teamState === next) return;
    const from = this.teamState;
    this.teamState = next;
    const label = { adventuring: '🗺️ 冒险中', combat: '⚔️ 战斗中', camp: '🔥 营地休整' }[next] || next;
    this.logMsg('state', '━━━ 团队状态：' + label + '（' + from + ' → ' + next + '）' + (reason ? ' ' + reason : '') + ' ━━━');
  };

  game._enterCombatState = function () {
    this.setTeamState('combat');
    for (const [pid, p] of this.players) {
      const st = this._playerState(p);
      if (!st.combat) { st.combat = true; this.logMsg('state', '⚔️ ' + p.name + ' 进入战斗状态', { actor: pid }); }
    }
  };
  game._exitCombatState = function () {
    for (const [pid, p] of this.players) {
      const st = this._playerState(p);
      st.combat = false;
      // 战斗限定的buff/减益在战斗结束时清除（祝福术/猎人印记/蛛网/倒地）
      st.buffs = st.buffs.filter(b => !b.combatOnly);
      st.debuffs = st.debuffs.filter(d => !d.combatOnly);
    }
    this.setTeamState(this.camp?.active ? 'camp' : 'adventuring');
  };

  game.addBuff = function (pid, buff) {
    const p = this.players.get(pid);
    if (!p) return;
    const st = this._playerState(p);
    st.buffs = st.buffs.filter(b => b.id !== buff.id);
    st.buffs.push(buff);
  };
  game.removeBuff = function (pid, id) {
    const p = this.players.get(pid);
    if (!p) return;
    const st = this._playerState(p);
    st.buffs = st.buffs.filter(b => b.id !== id);
  };
  game.addDebuff = function (pid, debuff) {
    const p = this.players.get(pid);
    if (!p) return;
    const st = this._playerState(p);
    st.debuffs = st.debuffs.filter(d => d.id !== debuff.id);
    st.debuffs.push(debuff);
  };
  game.removeDebuff = function (pid, id) {
    const p = this.players.get(pid);
    if (!p) return;
    const st = this._playerState(p);
    st.debuffs = st.debuffs.filter(d => d.id !== id);
  };

  // 快照用：玩家状态摘要（存活/死亡、战斗中、冒险中、buff组、debuff组）
  game.playerStateSummary = function (p) {
    const st = this._playerState(p);
    return {
      alive: !p.dead,
      downed: !!p.downed,
      combat: !!st.combat,
      mode: this.teamState === 'combat' ? 'combat' : (this.teamState === 'camp' ? 'camp' : 'adventuring'),
      buffs: st.buffs.map(b => ({ id: b.id, name: b.name, icon: b.icon })),
      debuffs: st.debuffs.map(d => ({ id: d.id, name: d.name, icon: d.icon })),
    };
  };
}
