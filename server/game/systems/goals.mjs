// 隐藏目标系统（S2-5 架构迁移）：目标宣称/结算判定/冒险评价，自 game.mjs 原样迁出，行为零变更

import { offlineVerify } from '../hiddengoals.mjs';

export function installGoals(game) {
  game.actClaim = async function (pid) {
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

  game.evaluate = async function (pid) {
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

  game._ratePlayer = function (s, alive) {
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

  // 结算时自动判定隐藏目标（离线机械验证；宣称按钮已移除）——自 _endGame 迁出
  game._verifyPendingGoals = function () {
    for (const [pid, p] of this.players) {
      const g2 = p.goals[0];
      if (g2 && g2.status === 'pending') {
        const okRes = offlineVerify(g2, p.stats, !p.dead);
        g2.status = okRes ? 'confirmed' : 'denied';
        this.logMsg('goal', (okRes ? '🏆 ' : '❌ ') + p.name + ' 的隐藏目标「' + g2.name + '」' + (okRes ? '达成' : '未达成') + '（结算判定）', { private: pid });
      }
    }
  };
}
