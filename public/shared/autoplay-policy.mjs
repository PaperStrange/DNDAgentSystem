// 自动游玩策略：机器人与浏览器autoplay共用。输入游戏快照，输出一个行动。
export function createPolicy(throttleMs = 200) {
  const mem = { talked: new Set(), lastAct: 0, claimed: new Set(), searchTried: new Set(), throttle: throttleMs };
  return {
    decide: (gv, pid) => decide(gv, pid, mem),
    setThrottle: (ms) => { mem.throttle = ms; },
    mem,
  };
}

function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }

// 客户端BFS：计算从from到to的合法下一步（避免向被阻挡的格子发无效移动）
function nextStep(gv, from, to) {
  const W = gv.map.w, H = gv.map.h, tiles = gv.map.tiles;
  if (from.x === to.x && from.y === to.y) return null;
  const key = (x, y) => y * W + x;
  const start = key(from.x, from.y), goal = key(to.x, to.y);
  const prev = new Map(), q = [start], seen = new Set([start]);
  while (q.length) {
    const k = q.shift();
    if (k === goal) break;
    const x = k % W, y = Math.floor(k / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nk = key(nx, ny);
      if (seen.has(nk)) continue;
      const t = tiles[ny] ? tiles[ny][nx] : '#';
      if (t === '#' || t === 'T' || t === 'D' || t === '~') continue;
      seen.add(nk); prev.set(nk, k); q.push(nk);
    }
  }
  if (!prev.has(goal)) return null;
  let cur = goal;
  while (prev.get(cur) !== start) cur = prev.get(cur);
  return { x: cur % W, y: Math.floor(cur / W) };
}
// 移动决策：目标可达则直接发目标点（服务器一次走满速度）；不可达返回null
function moveToward(gv, ent, target, mem) {
  if (target.x === ent.x && target.y === ent.y) return null;
  const step = nextStep(gv, ent, target);
  if (!step) return null;
  mem.lastWasMove = true;
  mem.moveFrom = ent.x + ',' + ent.y; // 拥堵检测：记住发移动时的位置
  return { type: 'move', x: target.x, y: target.y };
}

function decide(gv, pid, mem) {
  if (!gv || gv.state !== 'playing' || gv.win) return null;
  const me = gv.me;
  if (!me || me.pid !== pid) return null;
  if (!gv.turn || gv.turn.playerId !== pid) return null;
  const now = Date.now();
  if (now - mem.lastAct < (mem.throttle || 200)) return null; // 温和节流（有节拍器兜底，不会死锁）
  // 对话（仅限自己回合，且受节流约束）：优先解救类，其次情报，再次其他援助，最后交易
  if (gv.dialogue) {
    const infoTags = ['investigation', 'persuasion', 'insight', 'religion', 'arcana'];
    const opt = gv.dialogue.options.find(o => o.available && o.tag === 'aid' && o.text.includes('解救'))
      || gv.dialogue.options.find(o => o.available && infoTags.includes(o.tag))
      || gv.dialogue.options.find(o => o.available && o.tag === 'aid')
      || gv.dialogue.options.find(o => o.available);
    if (!opt) return { type: 'endturn' };
    mem.lastAct = Date.now();
    return { type: 'dialogue', optionId: opt.id };
  }
  // F-30：BOSS遭遇表决——自动游玩上下文默认同意开战（不逃跑）
  if (gv.bossVote && gv.bossVote.active && !gv.bossVote.myVote) {
    mem.lastAct = now;
    return { type: 'bossVote', vote: 'agree' };
  }
  // F-30：已同意开战的玩家让出回合（等待其他队友表决，避免攻击被表决拦截造成空转死锁）
  if (gv.bossVote && gv.bossVote.active && gv.bossVote.myVote === 'agree') {
    mem.lastAct = now;
    return { type: 'endturn' };
  }
  // F-30：营地休整——自动游玩先恢复生命（有短休次数且血量不满），再回到冒险
  if (gv.camp && gv.camp.active && gv.turn && gv.turn.playerId === pid) {
    const entCamp = gv.entities.find(e => e.eid === me.eid);
    if ((me.charges?.shortrest || 0) > 0 && entCamp && entCamp.hp / entCamp.maxHp < 0.92) {
      mem.lastAct = now;
      return { type: 'campRest' };
    }
    mem.lastAct = now;
    return { type: 'campLeave' };
  }
  const ent = gv.entities.find(e => e.eid === me.eid);
  if (!ent || ent.hp <= 0 || me.dead || me.downed) { mem.lastAct = now; return { type: 'endturn' }; }
  // 拥堵检测：上次发的移动未产生位移（被队友/NPC挡路、目标格被占）→ 结束回合，避免空转烧看门狗
  const curPos = ent.x + ',' + ent.y;
  if (mem.lastWasMove && mem.moveFrom === curPos) {
    mem.lastWasMove = false;
    mem.lastAct = now;
    return { type: 'endturn' };
  }
  mem.lastWasMove = false;
  const foes = gv.entities.filter(e => e.kind === 'monster' && !e.dead && e.hp > 0);
  // 优先集火：可攻击范围内的最低血量敌人，否则最近的敌人
  const inRange = foes.filter(f => manhattan(ent, f) <= 9).sort((a, b) => a.hp - b.hp);
  const nearFoe = inRange[0] || foes.sort((a, b) => manhattan(ent, a) - manhattan(ent, b))[0] || null;

  // 宣称隐藏目标（条件满足时）
  if (me.goal && me.goal.status === 'pending' && me.claimCooldown === 0 && estimateGoal(me, gv)) {
    mem.lastAct = now;
    return { type: 'claim' };
  }

  if (nearFoe || gv.combat.active) {
    return combatDecide(gv, me, ent, nearFoe, foes, mem, now);
  }
  return exploreDecide(gv, me, ent, foes, mem, now);
}

// 隐藏目标达成估算（与服务端离线模板一致的判定）
function estimateGoal(me, gv) {
  const s = me.stats, alive = !me.dead;
  const g = me.goal;
  switch (g.id) {
    case 'warlust': return s.damageDealt >= 100;
    case 'hunter': return s.kills >= 4;
    case 'pacifist': return s.damageDealt === 0 && alive && gv.chapter.id === 'cave';
    case 'rich': return s.goldEarned >= 120;
    case 'healer': return s.healed >= 40;
    case 'arcanist': return s.spellsCast >= 5;
    case 'diplomat': return ['persuasion', 'deception', 'intimidation'].every(t => s.talkTags.includes(t));
    case 'lucky': return s.crits >= 2;
    case 'survivor': return s.downedCount >= 1 && alive;
    case 'explorer': return s.searches + s.chestsOpened >= 6;
    case 'dragonslayer': return s.bossLastHit === true;
    case 'shadow': return s.usesHide >= 3;
    case 'bastion': return s.damageTaken >= 100 && alive;
    case 'pyromancer': return s.maxMultiHit >= 3;
    case 'rescuer': return s.rescues.includes('sildar') && s.rescues.includes('gundren');
    case 'flawless': return s.downedCount === 0 && s.damageTaken < 60 && alive && gv.chapter.id === 'cave';
    case 'vanguard': return s.initiativeWins >= 2;
    case 'ascetic': return s.restsUsed === 0 && alive && gv.chapter.id === 'cave';
    default: return false;
  }
}

function weaponFor(gv, me, ent, foe) {
  const d = manhattan(ent, foe);
  const ws = (me.attacks || []).filter(a => a.kind === 'weapon');
  const melee = ws.find(a => a.melee);
  const ranged = ws.find(a => !a.melee);
  if (melee && d <= melee.range) return melee;
  if (ranged && d <= ranged.range && losClearSafe(gv, ent, foe)) return ranged;
  return null;
}

function combatDecide(gv, me, ent, target, foes, mem, now) {
  if (!target) { mem.lastAct = now; return { type: 'endturn' }; }
  const turn = gv.turn;
  const d = manhattan(ent, target);
  const done = (a) => { mem.lastAct = now; return a; };
  // 附赠动作：治疗祷言（优先倒地队友，其次最低血量）
  const clericHeal = (me.bonusAttacks || []).find(a => a.id === 's:healingword');
  const hurtAllies = gv.entities.filter(e => e.kind === 'player' && !e.dead && e.hp < e.maxHp)
    .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
  const hurtAlly = hurtAllies.find(e => manhattan(ent, e) <= 6);
  if (hurtAlly && clericHeal && !turn.bonusUsed && me.slots && me.slots['1'] > 0) {
    return done({ type: 'cast', spellId: 's:healingword', targetEid: hurtAlly.eid });
  }
  // 附赠动作：药水自救（血量偏低时更积极，20260822批次平衡：0.35→0.5）
  if (!turn.bonusUsed && me.items.potion > 0 && ent.hp / ent.maxHp < 0.5) {
    return done({ type: 'item', itemId: 'potion', targetEid: ent.eid });
  }
  // 动作：攻击/群体法术/远程法术（仅当动作未使用）
  if (!turn.actionUsed) {
    const wp = weaponFor(gv, me, ent, target);
    if (wp) return done({ type: 'attack', targetEid: target.eid });
    const aoeSpell = (me.attacks || []).find(a => a.kind === 'aoe' && a.cost !== 'slot');
    if (aoeSpell && me.charges[aoeSpell.id] > 0) {
      const cluster = foes.filter(f => manhattan(f, target) <= 3);
      if (cluster.length >= 2 && d <= aoeSpell.range) return done({ type: 'cast', spellId: aoeSpell.id, x: target.x, y: target.y });
    }
    const slotAoe = (me.attacks || []).find(a => a.kind === 'aoe' && a.cost === 'slot');
    if (slotAoe && me.slots && me.slots['1'] > 0) {
      const cluster = foes.filter(f => manhattan(f, target) <= 3);
      if (cluster.length >= 2 && d <= slotAoe.range) return done({ type: 'cast', spellId: slotAoe.id, x: target.x, y: target.y });
    }
    if (me.items.flask > 0) {
      const cluster = foes.filter(f => manhattan(f, target) <= 3);
      if (cluster.length >= 2 && d <= 8) return done({ type: 'item', itemId: 'flask', x: target.x, y: target.y });
    }
    const sp = (me.attacks || []).find(a => ['spellAttack', 'saveAttack', 'autoHit'].includes(a.kind) && (a.cost === 'cantrip' || (a.cost === 'slot' && me.slots && me.slots['1'] > 0)));
    if (sp && d <= sp.range && losClearSafe(gv, ent, target)) return done({ type: 'cast', spellId: sp.id, targetEid: target.eid });
  }
  // 移动（朝目标靠近，直到进入武器射程或移动耗尽）
  const wp2 = weaponFor(gv, me, ent, target);
  if (turn.moveLeft > 0 && (d > 1 || !wp2)) {
    const mv = moveToward(gv, ent, target, mem);
    if (mv) return done(mv);
    // 当前目标不可达：尝试其他敌人
    const alt = foes.filter(f => f.eid !== target.eid).sort((a, b) => manhattan(ent, a) - manhattan(ent, b)).find(f => nextStep(gv, ent, f));
    if (alt) { const mv2 = moveToward(gv, ent, alt, mem); if (mv2) return done(mv2); }
  }
  return done({ type: 'endturn' });
}

function exploreDecide(gv, me, ent, foes, mem, now) {
  const turn = gv.turn;
  const chapterId = gv.chapter.id;
  // NPC优先级：①有可执行的"解救"类选项（如已拿到钥匙） ②没聊过的NPC
  const npcDefs = gv.npcDefs || {};
  const npcEnts = gv.entities.filter(e => e.kind === 'npc');
  const rescueNpc = npcEnts.find(e => {
    const def = npcDefs[e.npcId];
    return def && def.options.some(o => o.available && o.tag === 'aid' && o.text.includes('解救'));
  });
  const freshNpc = npcEnts.find(e => !mem.talked.has(chapterId + ':' + e.npcId));
  const npc = rescueNpc || freshNpc;
  if (npc) {
    if (manhattan(ent, npc) <= 1 && !turn.actionUsed) {
      mem.talked.add(chapterId + ':' + npc.npcId);
      mem.lastAct = now;
      return { type: 'interact', targetEid: npc.eid };
    }
    if (turn.moveLeft > 0) {
      const mv = moveToward(gv, ent, npc, mem);
      if (mv) { mem.lastAct = now; return mv; }
    }
    mem.lastAct = now;
    return { type: 'endturn' };
  }
  // 宝箱
  const chest = gv.map.chests.find(c => !c.opened);
  if (chest) {
    if (manhattan(ent, chest) <= 1 && !turn.actionUsed) {
      mem.lastAct = now;
      return { type: 'interact', tx: chest.x, ty: chest.y };
    }
    if (turn.moveLeft > 0) {
      const mv = moveToward(gv, ent, chest, mem);
      if (mv) { mem.lastAct = now; return mv; }
    }
    mem.lastAct = now;
    return { type: 'endturn' };
  }
  // 搜索点
  const prop = (gv.map.props || []).find(p => !p.searched && p.type !== 'campfire');
  if (prop) {
    if (manhattan(ent, prop) <= 1 && !turn.actionUsed && !mem.searchTried.has(chapterId + ':' + prop.x + ':' + prop.y)) {
      mem.searchTried.add(chapterId + ':' + prop.x + ':' + prop.y);
      mem.lastAct = now;
      return { type: 'search' };
    }
    if (turn.moveLeft > 0) {
      const mv = moveToward(gv, ent, prop, mem);
      if (mv) { mem.lastAct = now; return mv; }
    }
    mem.lastAct = now;
    return { type: 'endturn' };
  }
  // 休息（20260822批次平衡：阈值0.55→0.7，战后保持健康，配合营地短休恢复）
  if (!turn.actionUsed && ent.hp / ent.maxHp < 0.7 && me.charges.shortrest > 0) {
    mem.lastAct = now;
    return { type: 'rest' };
  }
  // 出口：优先去未访问过的章节（避免在已清空的章节间来回）
  if (!mem.visited) mem.visited = new Set();
  mem.visited.add(chapterId);
  const openExits = gv.exits.filter(e => e.open);
  const openExit = openExits.find(e => e.to && !mem.visited.has(e.to)) || openExits[0];
  if (openExit && (gv.chapter.objectiveDone || foes.length === 0)) {
    if (manhattan(ent, openExit) <= 1 && !turn.actionUsed) {
      mem.lastAct = now;
      return { type: 'interact', tx: openExit.x, ty: openExit.y };
    }
    if (turn.moveLeft > 0) {
      const mv = moveToward(gv, ent, openExit, mem);
      if (mv) { mem.lastAct = now; return mv; }
    }
    mem.lastAct = now;
    return { type: 'endturn' };
  }
  // 还有敌人：去找他们
  if (foes.length) {
    const sorted = foes.sort((a, b) => manhattan(ent, a) - manhattan(ent, b));
    const foe = sorted.find(f => nextStep(gv, ent, f)) || sorted[0];
    const mv = moveToward(gv, ent, foe, mem);
    if (mv) { mem.lastAct = now; return mv; }
  }
  mem.lastAct = now;
  return { type: 'endturn' };
}

function losClearSafe(gv, a, b) {
  try {
    let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      if (x0 === x1 && y0 === y1) break;
      const t = gv.map.tiles[y0]?.[x0];
      if (t === '#' || t === 'T' || t === 'D') return false;
    }
    return true;
  } catch { return true; }
}
