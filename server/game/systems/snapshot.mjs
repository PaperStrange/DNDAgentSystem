// 快照系统（S2-5 架构迁移）：玩家视图快照/先攻条/事件树快照/NPC定义，自 game.mjs 原样迁出，行为零变更

import { NPCS } from '../dungeon.mjs';
import { XP_NEED } from '../game.mjs';

export function installSnapshot(game) {
  game.snapshotFor = function (pid) {
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

  game._teamOrder = function () {
    const es = [];
    for (const [pid, p] of this.players) {
      if (p.dead) continue;
      const e = this.entities.get(p.eid);
      if (e && !e.dead) es.push(e);
    }
    return es.sort((a, b) => this._dexOf(b) - this._dexOf(a)).map(e => e.eid);
  }

  game._eventTreesSnapshot = function () {
    const out = {};
    for (const [pid, tree] of this.eventTrees) out[pid] = tree.slice(-80);
    return out;
  }

  game._npcDefsFor = function (pid) {
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
