// 营地系统（F-30）：短休不再立即回血，而是进入营地界面——
// 队伍围坐篝火；右侧行动：恢复生命值（消耗短休次数）/购买商品（营地商人概率刷新）/回到冒险（位置保留）
// 战斗中无法进入短休（actShortRest原校验）；营地行动仅限发起休整者（其回合）
import { roll, rnd } from '../../util.mjs';

export function installCamp(game) {
  game.camp = { active: false, ownerPid: null, merchant: false };

  game.enterCamp = function (pid) {
    const p = this.players.get(pid);
    const e = this.entities.get(p?.eid);
    if (!p || !e) return { ok: false, msg: '你无法行动' };
    this.camp.active = true;
    this.camp.ownerPid = pid;
    this.camp.merchant = rnd() < 0.5; // 营地商人概率刷新（50%）
    this.setTeamState('camp', '队伍点燃篝火，围坐休整');
    this.logMsg('system', '🏕️ ' + e.name + ' 提议短休。队伍在营地燃起篝火（本次营地' + (this.camp.merchant ? '有一位路过的商人' : '没有商人经过') + '）。');
    this.narrate('campStart', { actor: e.name });
    this.onChange();
    return { ok: true, camp: true };
  };

  // 营地行动守卫：营地期间所有玩家暂停普通冒险动作（仅休整者可选营地行动）
  game._campGuard = function (pid) {
    if (this.camp?.active) {
      const ownerName = this.players.get(this.camp.ownerPid)?.name || '队友';
      return { ok: false, msg: '队伍正在营地休整，等待 ' + ownerName + ' 选择营地行动' };
    }
    return null;
  };

  // 恢复生命值：消耗1次短休，掷生命骰恢复（5E短休规则）
  game.campRest = function (pid) {
    const p = this.players.get(pid);
    if (!this.camp?.active || this.camp.ownerPid !== pid) return { ok: false, msg: '不是你的营地行动' };
    if ((p.charges.shortrest || 0) <= 0) return { ok: false, msg: '本章的短休次数已用完' };
    const e = this.entities.get(p.eid);
    if (!e) return { ok: false, msg: '你无法行动' };
    p.charges.shortrest--;
    p.stats.restsUsed++;
    if (this.chapterPerf) this.chapterPerf.restsUsed++;
    const d = roll('1d' + p.sheet.hitDie);
    const heal = d.total + p.sheet.mods.CON;
    this._heal(e, heal, e);
    this.logMsg('system', '🍖 ' + e.name + ' 在营地短休，恢复 ' + heal + ' 点生命（短休剩余' + p.charges.shortrest + '次）');
    this.narrate('rest', { actor: e.name });
    this.onChange();
    return { ok: true };
  };

  // 购买商品（仅当本次营地有商人）：治疗药水50金/炼金火焰瓶40金
  game.campBuy = function (pid, { itemId }) {
    const p = this.players.get(pid);
    if (!this.camp?.active || this.camp.ownerPid !== pid) return { ok: false, msg: '不是你的营地行动' };
    if (!this.camp.merchant) return { ok: false, msg: '这次营地里没有商人经过' };
    const goods = { potion: { name: '治疗药水', price: 50 }, flask: { name: '炼金火焰瓶', price: 40 } };
    const g = goods[itemId];
    if (!g) return { ok: false, msg: '商人没有这个商品' };
    if (p.gold < g.price) return { ok: false, msg: '金币不足' };
    p.gold -= g.price;
    p.items[itemId] = (p.items[itemId] || 0) + 1;
    this.logMsg('system', '🛒 ' + p.name + ' 从营地商人处购买了' + g.name + '（-' + g.price + '金）');
    this.onChange();
    return { ok: true };
  };

  // 回到冒险：位置保留（营地期间不允许移动），结束休整者回合
  game.campLeave = function (pid) {
    if (!this.camp?.active || this.camp.ownerPid !== pid) return { ok: false, msg: '不是你的营地行动' };
    this.camp.active = false;
    this.camp.ownerPid = null;
    this.setTeamState('adventuring');
    this.logMsg('system', '🚶 队伍收拾行装，重新踏上冒险（位置保持不变）。');
    if (this.turn && this.turn.playerId === pid) this._endTurn();
    else this.onChange();
    return { ok: true };
  };
}
