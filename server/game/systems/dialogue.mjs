// 对话系统（架构迁移）：NPC对话树/互动地块（门/宝箱/出口/篝火）解析，与回合/战斗系统解耦
import { roll, manhattan } from '../../util.mjs';
import { NPCS } from '../dungeon.mjs';

export function installDialogue(game) {
  game.actInteract = function (pid, { targetEid, tx, ty }) {
    const p = this.players.get(pid);
    const t = this.turn;
    if (!p || !t || t.playerId !== pid) return { ok: false, msg: '不是你的回合' };
    if (t.actionUsed) return { ok: false, msg: '本回合已使用动作' };
    const e = this.entities.get(p.eid);
    // 目标实体（NPC/箱子）
    if (targetEid) {
      const ent = this.entities.get(targetEid);
      if (!ent) return { ok: false, msg: '目标无效' };
      const d = manhattan(e, ent);
      if (ent.kind === 'npc') {
        if (d > 2) return { ok: false, msg: '距离太远' };
        t.actionUsed = true;
        return this._openDialogue(p, ent);
      }
      return { ok: false, msg: '无法与这个目标互动' };
    }
    // 地块互动（门/宝箱/出口/篝火）
    const tile = this.map.tiles[ty][tx];
    const d = manhattan(e, { x: tx, y: ty });
    if (d > 1) return { ok: false, msg: '距离太远' };
    if (tile && tile.door) {
      t.actionUsed = true;
      tile.type = 'floor'; tile.blockMove = false; tile.blockSight = false; tile.door = false;
      this.logMsg('system', '🚪 ' + e.name + ' 打开了门');
      return { ok: true };
    }
    const chest = this.map.chests.find(c => c.x === tx && c.y === ty && !this.openedChests.has(this.chapter.id + ':' + c.x + ':' + c.y));
    if (chest) {
      t.actionUsed = true;
      this.openedChests.add(this.chapter.id + ':' + chest.x + ':' + chest.y);
      const g = roll(chest.gold || '1d10');
      p.gold += g.total; p.stats.goldEarned += g.total; p.stats.chestsOpened++;
      this.narrate('chest', { actor: e.name, item: g.total + '枚金币' });
      this.logMsg('system', '🎁 ' + e.name + ' 打开' + chest.desc + '，获得 ' + g.total + ' 金币');
      return { ok: true };
    }
    const exit = this.map.exit && this.map.exit.x === tx && this.map.exit.y === ty ? this.map.exit : null;
    const exit2 = this.map.exit2 && this.map.exit2.x === tx && this.map.exit2.y === ty ? this.map.exit2 : null;
    const targetExit = exit || exit2;
    if (targetExit) {
      t.actionUsed = true;
      return this._tryTravel(targetExit, p);
    }
    const prop = this.map.props?.find(pr => pr.x === tx && pr.y === ty);
    if (prop && prop.type === 'campfire') {
      t.actionUsed = true;
      if ((p.charges.longrest || 0) <= 0) return { ok: false, msg: '本章已长休过了', undo: true };
      p.charges.longrest = 0;
      p.stats.restsUsed++;
      const pe = this.entities.get(p.eid);
      pe.hp = pe.maxHp; p.sheet.hp = pe.maxHp;
      if (p.slots) p.slots = { 1: p.level >= 2 ? 3 : 2 };
      p.charges.shortrest = 2;
      p.downed = false; pe.downed = false; p.deathSaves = { s: 0, f: 0 };
      this.narrate('rest', { actor: e.name });
      this.logMsg('system', '🔥 篝火旁长休：' + e.name + ' 完全恢复了！');
      return { ok: true };
    }
    return { ok: false, msg: '这里没有可互动的东西' };
  };

  game._openDialogue = function (p, npcE) {
    const npcDef = NPCS[npcE.npcId];
    if (!npcDef) return { ok: false, msg: 'NPC数据缺失，请刷新页面重试' };
    p.stats.npcTalks++;
    const options = npcDef.options.map(o => {
      let available = true, hint = null;
      if (o.need && !p.keys.includes(o.need) && !this.keys.has(o.need)) { available = false; hint = o.missingText || '缺少道具'; }
      if (o.once && this.flags.has('dlg:' + npcE.npcId + ':' + o.id)) available = false;
      if (o.cost && o.cost.gold > p.gold) { available = false; hint = '金币不足'; }
      return { id: o.id, text: o.text, tag: o.tag, available, hint };
    });
    this.dialogues.set(p.pid, { npcEid: npcE.eid, npcName: npcDef.name, greet: npcDef.greet, options });
    this.narrate('npcTalk', { actor: p.name, target: npcDef.name });
    return { ok: true, dialogue: true };
  };

  game.actDialogueOption = function (pid, { optionId }) {
    const p = this.players.get(pid);
    const dlg = this.dialogues.get(pid);
    if (!p || !dlg) return { ok: true }; // 对话已关闭：静默成功，防竞态刷屏
    const npcE = this.entities.get(dlg.npcEid);
    const npcDef = NPCS[npcE?.npcId];
    if (!npcDef) return { ok: false, msg: 'NPC数据缺失，请刷新页面重试' };
    const opt = npcDef.options.find(o => o.id === optionId);
    if (!opt) return { ok: false, msg: '选项无效' };
    if (opt.need && !p.keys.includes(opt.need) && !this.keys.has(opt.need)) return { ok: false, msg: opt.missingText || '缺少道具' };
    if (opt.once && this.flags.has('dlg:' + npcE.npcId + ':' + opt.id)) return { ok: false, msg: '已经做过了' };
    if (opt.cost) {
      if (opt.cost.gold && p.gold < opt.cost.gold) return { ok: false, msg: '金币不足' };
      p.gold -= opt.cost.gold || 0;
      if (opt.cost.item) p.items[opt.cost.item]++; // 购买类：花费金币，获得道具
    }
    this.flags.add('dlg:' + npcE.npcId + ':' + opt.id);
    this.dialogues.delete(pid);
    if (opt.tag) {
      p.stats.talkTags.push(opt.tag);
      if (['persuasion', 'deception', 'intimidation'].includes(opt.tag)) { /* 交涉标签已记录 */ }
    }
    const res = opt.result || {};
    if (res.flag) { this.flags.add(res.flag); if (res.flag === 'rescue_sildar' && !p.stats.rescues.includes('sildar')) p.stats.rescues.push('sildar'); if (res.flag === 'rescue_gundren' && !p.stats.rescues.includes('gundren')) p.stats.rescues.push('gundren'); if (res.flag === 'rescue_villager' && !p.stats.rescues.includes('villager')) p.stats.rescues.push('villager'); }
    if (res.gold) { p.gold += res.gold; p.stats.goldEarned += res.gold; }
    if (res.heal) { const pe = this.entities.get(p.eid); if (pe) this._heal(pe, res.heal, pe); }
    if (res.upgrade === 'weapon') { p.sheet.upgradeWeapon = true; }
    const reply = res.log || '……';
    this.logMsg('narr', '💬 ' + p.name + ' → ' + npcDef.name + '：「' + opt.text.replace(/^\[[^\]]+\]\s*/, '') + '」');
    this.logMsg('narr', '💬 ' + npcDef.name + '：' + reply, { dm: true });
    // 目标完成检查（救出西达尔 → 章节目标）
    this._checkChapterObjective();
    this._checkPublicWin();
    return { ok: true };
  };
}
