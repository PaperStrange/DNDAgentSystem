// 游戏主界面：像素画布 + 回合交互 + 战斗 + 对话 + 结算
import { store, el } from '../app.mjs';
import { TILE, drawTile, drawSprite, spritePalette } from '../pixel.mjs';
import { createPolicy } from '../../shared/autoplay-policy.mjs';

let SCALE = 4;

export function mountGame(root, view) {
  const net = store.net;
  const g = { view, pending: null, floaters: [], anim: new Map(), introSeen: false, autoplay: false, policy: createPolicy(), sfx: true, lastSnapSeq: 0, speed: 1, logFilter: 'all', cardSent: false };
  let raf = null, canvas, ctx, wrap, autoTicker = null;

  // ---------- DOM ----------
  const screen = el('div', 'screen-game');
  const top = el('div', 'game-top');
  const gtChapter = el('div', 'gt-chapter');
  const gtObj = el('div', 'gt-obj');
  const gtTurn = el('div', 'gt-turn');
  const modeBadge = el('div', 'badge', '🤖 自动战斗');
  modeBadge.title = '房主创建房间时设定的战斗模式';
  // 速度选择器（R-5）
  const speedSel = el('select', 'btn small');
  speedSel.style.cssText = 'padding:3px 6px;';
  for (const s of [0.5, 1, 2, 4]) {
    const o = document.createElement('option');
    o.value = String(s); o.textContent = s + 'x';
    speedSel.appendChild(o);
  }
  speedSel.value = '1';
  speedSel.onchange = () => {
    g.speed = Number(speedSel.value);
    net.send('game:speed', { speed: g.speed });
    g.policy.setThrottle(Math.round(200 / g.speed));
    restartTicker();
  };
  // 暂停按钮（R-5）
  const pauseBtn = el('button', 'btn small', '⏸ 暂停');
  pauseBtn.title = '暂停自动战斗（怪物停止行动，可安心查看日志）';
  pauseBtn.onclick = () => {
    g.paused = !g.paused;
    net.send('game:pause', { paused: g.paused });
    pauseBtn.textContent = g.paused ? '▶ 继续' : '⏸ 暂停';
    pauseBtn.classList.toggle('gold', g.paused);
  };
  const leaveBtn = el('button', 'btn small danger', '退出房间');
  leaveBtn.title = '离开冒险并退出房间';
  leaveBtn.onclick = () => { if (confirm('确定离开冒险并退出房间吗？')) net.send('room:leave'); };
  const sfxBtn = el('button', 'btn small', '🔊');
  sfxBtn.title = '音效开关';
  sfxBtn.onclick = () => { g.sfx = !g.sfx; sfxBtn.textContent = g.sfx ? '🔊' : '🔇'; };
  const autoBtn = el('button', 'btn small', '🤖 自动');
  autoBtn.title = '自动游玩开关（手动模式下可随时开启）';
  autoBtn.onclick = () => { g.autoplay = !g.autoplay; autoBtn.classList.toggle('gold', g.autoplay); };
  top.append(gtChapter, gtObj, gtTurn, modeBadge, speedSel, pauseBtn, autoBtn, sfxBtn, leaveBtn);
  screen.appendChild(top);

  const body = el('div', 'game-body');
  const canvasWrap = el('div', 'game-canvas-wrap');
  canvas = el('canvas', '');
  canvas.id = 'game-canvas';
  canvasWrap.appendChild(canvas);
  body.appendChild(canvasWrap);

  const side = el('div', 'game-side');
  body.appendChild(side);
  screen.appendChild(body);
  root.appendChild(screen);

  ctx = canvas.getContext('2d');
  wrap = canvasWrap;

  // ---------- 侧栏渲染 ----------
  function renderSide() {
    const v = g.view;
    if (!v || !v.game) return;
    const gv = v.game;
    side.innerHTML = '';

    // 我的状态
    const mePanel = el('div', 'panel side-panel');
    mePanel.appendChild(el('h4', '', '🧙 我的状态'));
    const me = gv.me;
    const myEnt = gv.entities.find(e => e.eid === me.eid);
    if (me && myEnt) {
      const hpRow = el('div', 'spread');
      hpRow.appendChild(el('div', '', me.name + ' Lv' + me.level + ' · AC' + me.sheet.ac));
      hpRow.appendChild(el('div', 'muted', myEnt.hp + '/' + myEnt.maxHp));
      mePanel.appendChild(hpRow);
      const bar = el('div', 'hpbar');
      const fill = el('div', 'fill' + (myEnt.hp / myEnt.maxHp < .35 ? ' low' : ''));
      fill.style.width = (myEnt.hp / myEnt.maxHp * 100) + '%';
      bar.appendChild(fill);
      mePanel.appendChild(bar);
      const info = el('div', 'stats-line mt8', '💰 ' + me.gold + '金 · 经验池 ' + gv.xpPool + ' · ' + (me.slots ? '法术位 ' + me.slots['1'] + '/' + (me.level >= 2 ? 3 : 2) : '无施法'));
      mePanel.appendChild(info);
      mePanel.appendChild(info);
    }
    side.appendChild(mePanel);

    // R-8: 背包面板（金币/道具/剧情钥匙/武器强化状态）
    const bagPanel = el('div', 'panel side-panel');
    bagPanel.appendChild(el('h4', '', '🎒 背包'));
    const bagList = el('div', '');
    const keyName = { cage_key: '笼子钥匙', castle_key: '城堡钥匙' };
    const bagAdd = (icon, name, cnt, desc, click) => {
      const row = el('div', 'spread');
      const left = el('div', '', icon + ' ' + name + (cnt !== undefined ? ' ×' + cnt : ''));
      left.title = desc || '';
      row.appendChild(left);
      if (click) {
        const b = el('button', 'btn small', '使用');
        b.onclick = click;
        row.appendChild(b);
      }
      bagList.appendChild(row);
    };
    bagAdd('💰', '金币', me.gold, '冒险中获得的金币，可在商店消费');
    bagAdd('🧪', '治疗药水', me.items.potion, '附赠动作使用：恢复2d4+2生命（点击目标后使用）', me.items.potion > 0 ? () => setPending({ kind: 'item', itemId: 'potion' }) : null);
    bagAdd('🧨', '炼金火焰瓶', me.items.flask, '动作使用：3x3范围2d6火焰伤害，敏捷豁免减半', me.items.flask > 0 ? () => setPending({ kind: 'item', itemId: 'flask' }) : null);
    for (const k of me.keys || []) bagAdd('🔑', keyName[k] || k, undefined, '剧情钥匙（队伍共有）');
    if (me.sheet.upgradeWeapon) bagAdd('⚔️', '附魔磨刀石', undefined, '已使用：武器伤害+1');
    bagList.appendChild(el('div', 'muted', me.slots ? '法术位：' + me.slots['1'] + '/' + (me.level >= 2 ? 3 : 2) : ''));
    bagPanel.appendChild(bagList);
    side.appendChild(bagPanel);

    // 回合提示 + 动作
    const actPanel = el('div', 'panel side-panel');
    actPanel.appendChild(el('h4', '', '⚡ 行动'));
    const myTurn = gv.turn && gv.turn.playerId === store.pid && gv.state === 'playing' && !gv.win;
    if (myTurn && gv.turn) {
      actPanel.appendChild(el('div', 'mode-hint', '👑 你的回合！移动 ' + gv.turn.moveLeft + ' 格' + (gv.turn.actionUsed ? '（动作已用）' : '') + (gv.turn.bonusUsed ? '（附赠已用）' : '')));
      const bar = el('div', 'action-bar');
      for (const a of me.attacks || []) {
        const btn = el('button', 'btn small', a.icon + ' ' + a.name);
        btn.disabled = gv.turn.actionUsed || (a.cost === 'slot' && (!me.slots || !me.slots['1'])) || (a.cost === 'chapter' && !(me.charges[a.id] > 0));
        btn.onclick = () => setPending({ kind: 'cast', spellId: a.id, attack: a });
        bar.appendChild(btn);
      }
      for (const a of me.bonusAttacks || []) {
        const btn = el('button', 'btn small', a.icon + ' ' + a.name + '·附赠');
        btn.disabled = gv.turn.bonusUsed || (a.cost === 'slot' && (!me.slots || !me.slots['1']));
        btn.onclick = () => setPending({ kind: 'cast', spellId: a.id, attack: a });
        bar.appendChild(btn);
      }
      const generic = [
        { label: '🔍 搜索', act: () => net.send('game:search') },
        { label: '🏃 疾走', act: () => net.send('game:dash') },
        { label: '🥷 躲藏', act: () => net.send('game:hide') },
        { label: '🍖 短休', act: () => net.send('game:rest') },
        { label: '👋 互动', act: () => setPending({ kind: 'interact' }) },
        { label: '🏆 宣称目标', act: () => net.send('game:claim') },
      ];
      for (const gc of generic) {
        const btn = el('button', 'btn small', gc.label);
        btn.disabled = gv.turn.actionUsed;
        btn.onclick = gc.act;
        bar.appendChild(btn);
      }
      actPanel.appendChild(bar);
      const endBtn = el('button', 'btn gold mt8', '⏭️ 结束回合');
      endBtn.style.width = '100%';
      endBtn.onclick = () => { clearPending(); net.send('game:endturn'); };
      actPanel.appendChild(endBtn);
    } else {
      const cur = gv.turn && gv.entities.find(e => e.eid === gv.turn.actorEid);
      actPanel.appendChild(el('div', 'mode-hint', gv.win ? '冒险已结束' : (cur ? '⏳ 等待 ' + cur.name + ' 行动…' : '……')));
    }
    actPanel.appendChild(el('div', 'mode-hint', g.pending ? pendingHint(g.pending) : ''));
    side.appendChild(actPanel);

    // 先攻列表
    if (gv.combat.active) {
      const initPanel = el('div', 'panel side-panel');
      initPanel.appendChild(el('h4', '', '⚔️ 战斗 第' + gv.combat.round + '回合'));
      const list = el('div', 'init-list');
      const curIdx = gv.combat.order.indexOf(gv.turn?.actorEid);
      for (const eid of gv.combat.order) {
        const e = gv.entities.find(x => x.eid === eid);
        if (!e) continue;
        const item = el('div', 'init-item' + (gv.turn && gv.turn.actorEid === eid ? ' now' : ''));
        item.appendChild(el('span', 'ii-icon', e.icon));
        item.appendChild(el('span', '', e.name + (e.downed ? ' 💀' : e.hp <= 0 ? ' ✝' : ' ' + e.hp + 'HP')));
        list.appendChild(item);
      }
      initPanel.appendChild(list);
      side.appendChild(initPanel);
    }

    // 隐藏目标
    if (me.goal) {
      const goalPanel = el('div', 'panel side-panel goal-card');
      goalPanel.appendChild(el('h4', '', '🔒 隐藏目标（仅你可见）'));
      goalPanel.appendChild(el('div', 'gc-text', '「' + me.goal.name + '」' + me.goal.text));
      goalPanel.appendChild(el('div', 'gc-status', me.goal.status === 'confirmed' ? '✅ 已达成' : me.goal.status === 'denied' ? '❌ 曾被驳回，继续努力' : '⏳ 未达成'));
      const claimBtn = el('button', 'btn small gold mt8', me.goal.status === 'confirmed' ? '已达成' : '宣称达成隐藏目标');
      claimBtn.disabled = me.goal.status === 'confirmed' || me.claimCooldown > 0;
      claimBtn.onclick = () => net.send('game:claim');
      goalPanel.appendChild(claimBtn);
      side.appendChild(goalPanel);
    }

    // 队伍
    const roster = el('div', 'panel side-panel');
    roster.appendChild(el('h4', '', '👥 队伍'));
    const rlist = el('div', 'player-roster');
    for (const p of gv.players) {
      const pe = gv.entities.find(e => e.eid === p.eid);
      const item = el('div', 'roster-item');
      item.appendChild(el('span', '', p.sheet.icon || '🧑'));
      item.appendChild(el('span', 'ri-name', p.name + (p.dead ? ' ✝' : '')));
      item.appendChild(el('span', 'ri-hp', pe ? pe.hp + '/' + pe.maxHp : '—'));
      if (v.room.hostId === store.pid && p.id !== store.pid) {
        const kick = el('button', 'btn small danger', '踢');
        kick.onclick = () => { if (confirm('踢出 ' + p.name + '？')) net.send('room:kick', { targetPid: p.id }); };
        item.appendChild(kick);
      }
      rlist.appendChild(item);
    }
    roster.appendChild(rlist);
    side.appendChild(roster);

    // 日志（R-7：过滤标签 + 关键信息高亮）
    const logPanel = el('div', 'panel side-panel');
    logPanel.appendChild(el('h4', '', '📜 ' + v.room.personaName + ' 的冒险日志'));
    const filterRow = el('div', 'row');
    filterRow.style.marginBottom = '6px';
    const filters = [['all', '全部'], ['combat', '⚔️战斗'], ['narr', '📖剧情'], ['dice', '🎲掷骰']];
    for (const [key, label] of filters) {
      const fb = el('button', 'btn small' + (g.logFilter === key ? ' gold' : ''), label);
      fb.onclick = () => { g.logFilter = key; renderSide(); };
      filterRow.appendChild(fb);
    }
    logPanel.appendChild(filterRow);
    const logBox = el('div', 'log-box');
    const highlight = (text) => {
      let cls = '';
      if (/🎉|🏆|升到了|获得新特性|BOSS|涅兹纳尔/.test(text)) cls = ' important';
      else if (/受到|💥/.test(text)) cls = ' dmg';
      else if (/恢复|💖|治疗/.test(text)) cls = ' heal';
      else if (/金币|💰/.test(text)) cls = ' gold';
      return cls;
    };
    for (const l of gv.log) {
      if (g.logFilter !== 'all') {
        if (g.logFilter === 'combat' && !['combat', 'dice'].includes(l.kind)) continue;
        if (g.logFilter === 'narr' && l.kind !== 'narr') continue;
        if (g.logFilter === 'dice' && l.kind !== 'dice') continue;
      }
      const div = el('div', 'lg ' + (l.kind || '') + highlight(l.text), l.text);
      logBox.appendChild(div);
    }
    logBox.scrollTop = logBox.scrollHeight;
    logPanel.appendChild(logBox);
    // 聊天
    const chatRow = el('div', 'chat-input-row mt8');
    const chatInput = el('input', '');
    chatInput.placeholder = '对队伍说点什么…（回车发送）';
    chatInput.onkeydown = (e) => {
      if (e.key === 'Enter' && chatInput.value.trim()) { net.send('game:say', { text: chatInput.value.trim() }); chatInput.value = ''; }
    };
    chatRow.appendChild(chatInput);
    logPanel.appendChild(chatRow);
    side.appendChild(logPanel);
  }

  function pendingHint(p) {
    if (p.kind === 'attack') return '🎯 点击一名敌人进行攻击（右键取消）';
    if (p.kind === 'cast' && p.attack) {
      if (p.attack.kind === 'aoe') return '💥 点击目标区域施放' + p.attack.name + '（右键取消）';
      if (p.attack.kind === 'heal') return '💖 点击队友（或空地对自己）施放' + p.attack.name;
      if (p.attack.kind === 'bless') return '🙏 点击确认施放祝福术';
      return '🔮 点击敌人施放' + p.attack.name + '（右键取消）';
    }
    if (p.kind === 'item' && p.itemId === 'potion') return '🧪 点击队友（或空地对自己）使用治疗药水';
    if (p.kind === 'item' && p.itemId === 'flask') return '🧨 点击目标区域投掷火焰瓶';
    if (p.kind === 'interact') return '👋 点击NPC/门/宝箱/出口进行互动';
    return '';
  }
  function setPending(p) { g.pending = p; renderSide(); }
  function clearPending() { g.pending = null; renderSide(); }

  // ---------- 音效 ----------
  function sfx(type) {
    if (!g.sfx || g.sfxBroken) return;
    try {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      const o = ac.createOscillator(), gn = ac.createGain();
      o.connect(gn); gn.connect(ac.destination);
      gn.gain.value = 0.04;
      const freq = { hit: 160, swing: 220, coin: 880, level: 660, die: 90, win: 523 }[type] || 300;
      o.frequency.value = freq;
      if (type === 'coin') o.frequency.setValueAtTime(660, ac.currentTime + .06);
      o.start(); o.stop(ac.currentTime + .12);
    } catch (e) { g.sfxBroken = true; /* 无音频设备时静默 */ }
  }

  // ---------- 渲染循环 ----------
  function resize() {
    const r = wrap.getBoundingClientRect();
    // 整数分辨率：防止CSS拉伸导致画面变形
    canvas.width = Math.max(100, Math.round(r.width));
    canvas.height = Math.max(100, Math.round(r.height));
    // 自适应缩放：目标可见约22列×13行，保证多人同屏时比例正常（3~6倍）
    const byW = canvas.width / (TILE * 22), byH = canvas.height / (TILE * 13);
    SCALE = Math.max(3, Math.min(6, Math.floor(Math.max(byW, byH))));
  }
  resize();
  window.addEventListener('resize', resize);
  // 关键修复：ResizeObserver持续监听容器尺寸——任何布局时序/侧栏渲染变化都立即同步缓冲，
  // 防止"缓冲小、CSS大"导致的画面拉伸
  let resizeObserver = null;
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(wrap);
  }
  requestAnimationFrame(() => resize()); // 布局完全结算后再校准一次

  function cameraPos() {
    const gv = g.view?.game;
    let cx = 0, cy = 0;
    if (gv) {
      let focus = null;
      if (gv.turn && gv.state === 'playing') focus = gv.entities.find(e => e.eid === gv.turn.actorEid);
      if (!focus && gv.me) focus = gv.entities.find(e => e.eid === gv.me.eid);
      if (focus) {
        const anim = g.anim.get(focus.eid) || { x: focus.x, y: focus.y };
        cx = anim.x; cy = anim.y;
      }
    }
    const vwT = canvas.width / SCALE / TILE, vhT = canvas.height / SCALE / TILE;
    let x = cx - vwT / 2 + .5, y = cy - vhT / 2 + .3;
    // 边界钳制：视野不超过地图范围，地图小于视野时居中（避免大片空白）
    if (gv) {
      if (vwT >= gv.map.w) x = (gv.map.w - vwT) / 2;
      else x = Math.max(0, Math.min(x, gv.map.w - vwT));
      if (vhT >= gv.map.h) y = (gv.map.h - vhT) / 2;
      else y = Math.max(0, Math.min(y, gv.map.h - vhT));
    }
    return { x, y };
  }

  function draw(t) {
    const gv = g.view?.game;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!gv) { raf = requestAnimationFrame(draw); return; }
    const cam = cameraPos();
    ctx.setTransform(SCALE, 0, 0, SCALE, -cam.x * TILE * SCALE, -cam.y * TILE * SCALE);
    ctx.imageSmoothingEnabled = false;
    const vw = Math.ceil(canvas.width / SCALE / TILE) + 2, vh = Math.ceil(canvas.height / SCALE / TILE) + 2;
    const ox = Math.floor(cam.x), oy = Math.floor(cam.y);
    // 瓦片
    for (let y = oy; y < oy + vh; y++) {
      for (let x = ox; x < ox + vw; x++) {
        if (x < 0 || y < 0 || x >= gv.map.w || y >= gv.map.h) { drawTile(ctx, '#', x, y, t); continue; }
        drawTile(ctx, gv.map.tiles[y][x], x, y, t);
      }
    }
    // 宝箱/道具/出口覆盖
    for (const c of gv.map.chests) if (c.x >= ox - 1 && c.x < ox + vw && c.y >= oy - 1 && c.y < oy + vh) drawTile(ctx, c.opened ? 'o' : 'c', c.x, c.y, t);
    for (const pr of gv.map.props) if (pr.x >= ox - 1 && pr.x < ox + vw && pr.y >= oy - 1 && pr.y < oy + vh) {
      const code = { campfire: 'f', rock: 'k', barrel: 'b', crystal: 'y' }[pr.type];
      if (code) drawTile(ctx, code, pr.x, pr.y, t);
    }
    for (const ex of gv.exits) if (ex.x >= ox - 1 && ex.x < ox + vw && ex.y >= oy - 1 && ex.y < oy + vh) drawTile(ctx, 'x', ex.x, ex.y, t);
    // 实体（按y排序）；同格堆叠时错开绘制，多人同屏不重叠
    const ents = [...gv.entities].sort((a, b) => a.y - b.y || a.eid.localeCompare(b.eid));
    const stackIdx = new Map(); // tileKey -> 已绘制数量
    const STACK_OFFSETS = [[0, 0], [-3, -2], [3, -2], [0, -4], [-3, 2], [3, 2]];
    for (const e of ents) {
      // 平滑动画
      let anim = g.anim.get(e.eid);
      if (!anim) { anim = { x: e.x, y: e.y, lastX: e.x, lastY: e.y, moving: false, frame: 0 }; g.anim.set(e.eid, anim); }
      if (anim.lastX !== e.x || anim.lastY !== e.y) {
        anim.moving = true;
        const dx = e.x - anim.x, dy = e.y - anim.y;
        anim.x += dx * .3; anim.y += dy * .3;
        if (Math.abs(e.x - anim.x) < .06 && Math.abs(e.y - anim.y) < .06) { anim.x = e.x; anim.y = e.y; anim.moving = false; }
        anim.lastX = e.x; anim.lastY = e.y;
        anim.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy < 0 ? 'up' : 'down';
      }
      if (anim.moving) anim.frame++;
      else anim.frame = 0;
      if (e.x < ox - 1 || e.x >= ox + vw || e.y < oy - 1 || e.y >= oy + vh) continue;
      const tileKey = e.x + ',' + e.y;
      const sIdx = stackIdx.get(tileKey) || 0;
      stackIdx.set(tileKey, sIdx + 1);
      const so = STACK_OFFSETS[sIdx % STACK_OFFSETS.length];
      const px = anim.x * TILE + (TILE - 16) / 2 + so[0], py = anim.y * TILE + (TILE - 18) + 2 + so[1];
      let palette, cls = null, race = null, kind = 'player', defKey = null;
      if (e.kind === 'player') {
        const p = gv.players.find(x => x.eid === e.eid);
        if (p) { palette = spritePalette('player', null, p.sheet.colors); cls = p.sheet.class; race = p.sheet.race; }
      } else if (e.kind === 'monster') { kind = 'monster'; defKey = e.defKey; palette = spritePalette('monster', e.defKey); }
      else { kind = 'npc'; defKey = e.npcId; palette = spritePalette('npc', e.npcId); }
      // 阴影
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.fillRect(px + 3, py + 16, 10, 2);
      if (e.downed) { ctx.globalAlpha = .55; }
      drawSprite(ctx, kind, defKey, palette, px, py, { dir: anim.dir || 'down', frame: anim.frame, cls, race, bob: true });
      ctx.globalAlpha = 1;
      // 名字/血条：屏幕空间绘制（固定像素大小，不随缩放变形）
      const sx = (anim.x + so[0] / TILE - cam.x) * TILE * SCALE;
      const sy = (anim.y + so[1] / TILE - cam.y) * TILE * SCALE;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const nameW = Math.min(90, e.name.length * 11 + 10);
      if (e.kind === 'player') {
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        const by2 = sy - 16;
        ctx.fillStyle = 'rgba(0,0,0,.62)';
        ctx.fillRect(sx - nameW / 2, by2, nameW, 13);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(e.name.slice(0, 6), sx, by2 + 9);
        if (e.hp < e.maxHp) {
          const bw = Math.min(44, nameW);
          ctx.fillStyle = '#2a1020';
          ctx.fillRect(sx - bw / 2, by2 + 14, bw, 4);
          ctx.fillStyle = e.hp / e.maxHp > .35 ? '#7ec97a' : '#e06c5a';
          ctx.fillRect(sx - bw / 2, by2 + 14, Math.max(1, bw * e.hp / e.maxHp), 4);
        }
      } else if ((e.kind === 'monster' || e.kind === 'npc') && e.hp < e.maxHp && e.hp > 0) {
        const bw = 40;
        ctx.fillStyle = '#2a1020';
        ctx.fillRect(sx - bw / 2, sy - 14, bw, 4);
        ctx.fillStyle = e.hp / e.maxHp > .35 ? '#7ec97a' : '#e06c5a';
        ctx.fillRect(sx - bw / 2, sy - 14, Math.max(1, bw * e.hp / e.maxHp), 4);
      }
      if (e.boss || e.finalBoss) {
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,.62)';
        ctx.fillRect(sx - 44, sy - 30, 88, 14);
        ctx.fillStyle = '#ff8080';
        ctx.fillText('👑' + e.name.slice(0, 8), sx, sy - 19);
      }
      ctx.restore();
      // 目标指示
      if (g.pending && g.pending.target === e.eid) {
        ctx.strokeStyle = '#ffd040';
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 1, py - 1, 18, 20);
      }
      // 受伤闪烁
      if (e.flash && t - e.flash < 300) {
        ctx.fillStyle = 'rgba(255,80,60,.3)';
        ctx.fillRect(px, py, 16, 18);
      }
    }
    // 悬浮伤害数字（屏幕空间固定字号）
    g.floaters = g.floaters.filter(f => t - f.t0 < 1200);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const f of g.floaters) {
      const age = (t - f.t0) / 1200;
      ctx.globalAlpha = 1 - age;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, (f.x - cam.x) * TILE * SCALE + TILE * SCALE / 2, (f.y - cam.y) * TILE * SCALE - 8 - age * 16);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // 悬停高亮
    if (g.hover) {
      const tile = gv.map.tiles[g.hover.y]?.[g.hover.x];
      const occupied = gv.entities.find(e => e.x === g.hover.x && e.y === g.hover.y && !e.dead);
      ctx.strokeStyle = occupied ? '#ff8060' : 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(g.hover.x * TILE + .5, g.hover.y * TILE + .5, TILE - 1, TILE - 1);
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  // ---------- 输入 ----------
  function toTile(ev) {
    const r = canvas.getBoundingClientRect();
    const mx = (ev.clientX - r.left) / SCALE + cameraPos().x * TILE;
    const my = (ev.clientY - r.top) / SCALE + cameraPos().y * TILE;
    return { x: Math.floor(mx / TILE), y: Math.floor(my / TILE) };
  }
  canvas.addEventListener('mousemove', (ev) => { g.hover = toTile(ev); });
  canvas.addEventListener('mouseleave', () => { g.hover = null; });
  canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); clearPending(); });
  canvas.addEventListener('click', (ev) => {
    const gv = g.view?.game;
    if (!gv || gv.win || gv.state !== 'playing') return;
    const tile = toTile(ev);
    const entAt = gv.entities.find(e => e.x === tile.x && e.y === tile.y && !e.dead && e.hp > 0);
    const myEnt = gv.entities.find(e => e.eid === gv.me?.eid);
    const isMyTurn = gv.turn && gv.turn.playerId === store.pid;

    if (g.pending) {
      const p = g.pending;
      if (p.kind === 'interact') {
        if (entAt && entAt.kind === 'npc') net.send('game:interact', { targetEid: entAt.eid });
        else net.send('game:interact', { tx: tile.x, ty: tile.y });
        clearPending();
        return;
      }
      if (p.kind === 'item') {
        if (p.itemId === 'flask') net.send('game:item', { itemId: 'flask', targetEid: null, x: tile.x, y: tile.y });
        else net.send('game:item', { itemId: 'potion', targetEid: entAt && entAt.kind === 'player' ? entAt.eid : undefined });
        clearPending();
        return;
      }
      if (p.kind === 'attack' || p.kind === 'cast') {
        const a = p.attack;
        if (a && (a.kind === 'aoe')) {
          net.send('game:cast', { spellId: p.spellId, x: tile.x, y: tile.y });
          clearPending();
          return;
        }
        if (a && a.kind === 'heal') {
          if (entAt && entAt.kind === 'player') net.send('game:cast', { spellId: p.spellId, targetEid: entAt.eid });
          else net.send('game:cast', { spellId: p.spellId });
          clearPending();
          return;
        }
        if (a && (a.kind === 'bless' || a.kind === 'advantage')) {
          net.send('game:cast', { spellId: p.spellId });
          clearPending();
          return;
        }
        if (entAt && entAt.kind === 'monster') {
          net.send(p.kind === 'attack' ? 'game:attack' : 'game:cast', { targetEid: entAt.eid, spellId: p.spellId });
          clearPending();
          return;
        }
        return;
      }
      clearPending();
      return;
    }

    if (!isMyTurn) return;
    // 默认模式：点敌人=攻击，点NPC=对话，点地=移动
    if (entAt && entAt.kind === 'monster') {
      const weapon = (gv.me.attacks || []).find(a => a.kind === 'weapon' && manhattan(myEnt, entAt) <= a.range && (a.melee || losClear(gv, myEnt, entAt)));
      if (weapon) net.send('game:attack', { targetEid: entAt.eid });
      return;
    }
    if (entAt && entAt.kind === 'npc' && manhattan(myEnt, entAt) <= 2) {
      net.send('game:interact', { targetEid: entAt.eid });
      return;
    }
    net.send('game:move', { x: tile.x, y: tile.y });
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') clearPending();
    if (ev.key === ' ' && g.view?.game?.turn?.playerId === store.pid) { ev.preventDefault(); net.send('game:endturn'); }
  });

  function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  function losClear(gv, a, b) {
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
      if (t === '#' || t === 'T') return false;
    }
    return true;
  }

  // ---------- 快照更新 ----------
  function update(view) {
    const prev = g.view;
    const firstGame = !prev || prev.view !== 'game';
    g.view = view;
    const gv = view.game;
    // R-4: 按房主设定的模式初始化自动战斗（默认自动）；手动模式玩家自行操作
    if (firstGame && gv) {
      const mode = gv.mode || view.room?.mode || 'auto';
      g.autoplay = mode !== 'manual';
      autoBtn.classList.toggle('gold', g.autoplay);
      modeBadge.textContent = mode === 'manual' ? '🎮 手动操作' : '🤖 自动战斗';
      modeBadge.className = 'badge' + (mode === 'manual' ? '' : ' gold');
      if (gv.speed) { g.speed = gv.speed; speedSel.value = String(gv.speed); }
      if (gv.paused) { g.paused = true; pauseBtn.textContent = '▶ 继续'; pauseBtn.classList.add('gold'); }
    }
    // 伤害数字与闪烁
    if (gv && prev?.game) {
      for (const e of gv.entities) {
        const pe = prev.game.entities.find(x => x.eid === e.eid);
        if (pe && pe.hp < e.hp && e.hp - pe.hp >= 1) {
          g.floaters.push({ x: e.x, y: e.y, text: '+' + (e.hp - pe.hp), color: '#7ec97a', t0: performance.now() });
          sfx('heal');
        }
        if (pe && pe.hp > e.hp) {
          g.floaters.push({ x: e.x, y: e.y, text: '-' + (pe.hp - e.hp), color: '#ff8060', t0: performance.now() });
          e.flash = performance.now();
          sfx('hit');
        }
      }
      // 日志新增 → 音效
      const newLogs = gv.log.filter(l => l.seq > (prev.game.log[prev.game.log.length - 1]?.seq || 0));
      for (const l of newLogs) {
        if (l.text.includes('受到')) sfx('hit');
        else if (l.text.includes('金币')) sfx('coin');
        else if (l.text.includes('升级') || l.text.includes('升到了')) sfx('level');
        else if (l.text.includes('击败') || l.text.includes('战斗结束')) sfx('win');
      }
    }
    renderSide();
    renderOverlays(view);
    // 自动游玩（受速度影响；暂停时不驱动）
    if (g.autoplay && !g.paused && gv && !gv.win && gv.state === 'playing') {
      const action = g.policy.decide(gv, store.pid);
      if (action) dispatchPolicyAction(action);
    }
  }
  // 自动游玩节拍器：不依赖快照到达；间隔随速度倍率调整
  function restartTicker() {
    if (autoTicker) clearInterval(autoTicker);
    autoTicker = setInterval(() => {
      if (!g.autoplay || g.paused) return;
      const gv = g.view?.game;
      if (!gv || gv.win || gv.state !== 'playing') return;
      try {
        const action = g.policy.decide(gv, store.pid);
        if (action) dispatchPolicyAction(action);
      } catch (e) { /* 忽略 */ }
    }, Math.max(150, Math.round(600 / (g.speed || 1))));
  }
  restartTicker();
  function dispatchPolicyAction(a) {
    const gv = g.view?.game;
    if (!gv) return;
    switch (a.type) {
      case 'move': net.send('game:move', { x: a.x, y: a.y }); break;
      case 'attack': net.send('game:attack', { targetEid: a.targetEid }); break;
      case 'cast': net.send('game:cast', { spellId: a.spellId, targetEid: a.targetEid, x: a.x, y: a.y }); break;
      case 'item': net.send('game:item', { itemId: a.itemId, targetEid: a.targetEid, x: a.x, y: a.y }); break;
      case 'interact': net.send('game:interact', { targetEid: a.targetEid, tx: a.tx, ty: a.ty }); break;
      case 'dialogue': net.send('game:dialogue', { optionId: a.optionId }); break;
      case 'endturn': net.send('game:endturn'); break;
      case 'rest': net.send('game:rest'); break;
      case 'search': net.send('game:search'); break;
      case 'dash': net.send('game:dash'); break;
      case 'hide': net.send('game:hide'); break;
      case 'claim': net.send('game:claim'); break;
    }
  }

  // ---------- 覆盖层 ----------
  function renderOverlays(view) {
    // 每次先清理所有覆盖层，避免重复叠加遮挡交互
    document.querySelectorAll('.dialog-overlay, .overlay-screen').forEach(n => n.remove());
    const gv = view.game;
    if (!gv) return;
    if (gv.dialogue) {
      const ov = el('div', 'dialog-overlay');
      const box = el('div', 'dialog-box');
      box.appendChild(el('h3', '', '💬 与 ' + gv.dialogue.npcName + ' 交谈'));
      box.appendChild(el('div', 'dg-greet', gv.dialogue.greet));
      for (const o of gv.dialogue.options) {
        const b = el('button', 'btn dialog-opt', o.text);
        b.disabled = !o.available;
        if (!o.available && o.hint) b.title = o.hint;
        b.onclick = () => net.send('game:dialogue', { optionId: o.id });
        box.appendChild(b);
      }
      const close = el('button', 'btn small dialog-opt', '离开');
      close.onclick = () => net.send('game:endturn'); // 关闭对话并结束
      box.appendChild(close);
      ov.appendChild(box);
      document.body.appendChild(ov);
    }
    // 开场覆盖
    if (gv.state === 'intro' || (gv.state === 'playing' && !g.introSeen && gv.me?.goal)) {
      const ov = el('div', 'overlay-screen');
      const card = el('div', 'overlay-card');
      card.appendChild(el('h2', '', '⚔️ ' + view.room.dungeonName));
      card.appendChild(el('div', 'muted', view.room.personaName + '（AI DM）正在主持'));
      card.appendChild(el('div', 'ov-text mt8', gv.chapter.intro));
      card.appendChild(el('div', 'ov-text mt8', gv.dungeon.publicGoal.text));
      if (gv.me?.goal) {
        card.appendChild(el('div', 'ov-goal', '🔒 你的隐藏目标：「' + gv.me.goal.name + '」' + gv.me.goal.text + '（仅自己可见，全员各自达成即可获胜）'));
      } else {
        card.appendChild(el('div', 'ov-goal', '📜 命运正在为你写下隐藏目标……'));
      }
      const btn = el('button', 'btn gold big', gv.state === 'intro' ? '聆听命运的低语…' : '🎲 开始冒险！');
      if (gv.state === 'playing') {
        btn.onclick = () => { g.introSeen = true; ov.remove(); };
      } else {
        btn.disabled = true;
      }
      card.appendChild(btn);
      ov.appendChild(card);
      document.body.appendChild(ov);
    }
    // 结算覆盖（R-9：附带自动生成的冒险卡片）
    if (gv.win && gv.state === 'ended') {
      const ov = el('div', 'overlay-screen');
      const card = el('div', 'overlay-card');
      const w = gv.win;
      const title = w.kind === 'defeat' ? '💀 冒险失败' : w.kind === 'hidden' ? '🔮 命运胜利' : '🏆 冒险胜利';
      card.appendChild(el('h2', '', title));
      card.appendChild(el('div', 'ov-text', w.reason));
      card.appendChild(el('div', 'muted mt8', '用时 ' + Math.round(w.duration / 60000) + ' 分钟'));
      // 请求AI DM评价（一次），返回后生成并自动保存冒险卡片
      if (!g.cardSent && gv.me) {
        g.cardSent = true;
        net.send('game:eval');
      }
      const evalBox = el('div', 'adventure-card' + (g.cardEval ? '' : ' loading'));
      if (g.cardEval) {
        const e = g.cardEval;
        evalBox.appendChild(el('div', 'ac-title', '📇 冒险卡片'));
        evalBox.appendChild(el('div', 'ac-line', '剧本：《' + view.room.dungeonName + '》 · DM：' + view.room.personaName));
        const me = gv.me;
        const s = me.stats;
        evalBox.appendChild(el('div', 'ac-line', '主角：' + me.name + '（' + me.sheet.raceName + ' ' + me.sheet.className + ' Lv' + me.level + '）'));
        evalBox.appendChild(el('div', 'ac-line', '结局：' + (w.kind === 'defeat' ? '折戟沉沙' : '凯旋而归') + ' · 用时' + Math.round(w.duration / 60000) + '分钟'));
        const highs = [];
        if (s.damageDealt > 0) highs.push('输出' + s.damageDealt + '伤害');
        if (s.kills > 0) highs.push('击杀' + s.kills);
        if (s.crits > 0) highs.push('暴击' + s.crits + '次');
        if (s.healed > 0) highs.push('治疗' + s.healed);
        if (s.rescues.length) highs.push('救出' + s.rescues.length + '名NPC');
        if (s.goldEarned > 0) highs.push('斩获' + s.goldEarned + '金币');
        if (s.bossLastHit) highs.push('亲手终结黑蜘蛛');
        evalBox.appendChild(el('div', 'ac-line', '高光时刻：' + (highs.join(' · ') || '平安是福')));
        evalBox.appendChild(el('div', 'ac-rating', '评分 ' + e.rating.rank + '（' + e.rating.score + '分）'));
        evalBox.appendChild(el('div', 'ac-comment', '「' + e.comment + '」'));
        evalBox.appendChild(el('div', 'muted', '✅ 已自动收入你的冒险故事集（大厅可查看）'));
      } else {
        evalBox.appendChild(el('div', 'muted', '🖋 AI DM 正在为你的冒险撰写卡片…'));
      }
      card.appendChild(evalBox);
      const myGoal = gv.me?.goal;
      if (myGoal) {
        card.appendChild(el('div', 'ov-goal', '你的隐藏目标：「' + myGoal.name + '」' + (myGoal.status === 'confirmed' ? ' ✅ 已达成' : ' ❌ 未达成')));
      }
      const table = el('table', 'stat-table');
      for (const p of gv.players) {
        const s = p.stats;
        const tr = document.createElement('tr');
        tr.appendChild(el('td', '', p.sheet.icon + ' ' + p.name + (p.dead ? ' ✝' : '')));
        tr.appendChild(el('td', '', s ? ('伤害' + s.damageDealt + ' · 击杀' + s.kills + ' · 金币' + s.goldEarned) : ''));
        table.appendChild(tr);
      }
      card.appendChild(table);
      const btnRow = el('div', 'row mt16');
      btnRow.style.justifyContent = 'center';
      const backBtn = el('button', 'btn gold', '🏠 返回房间');
      backBtn.onclick = () => net.send('room:return');
      const leave2 = el('button', 'btn', '离开');
      leave2.onclick = () => net.send('room:leave');
      btnRow.append(backBtn, leave2);
      card.appendChild(btnRow);
      card.appendChild(el('div', 'credits', '由 ' + view.room.personaName + ' 主持 · 规则书：5E D&D 新手套组'));
      ov.appendChild(card);
      document.body.appendChild(ov);
    }
  }

  // ---------- 自动游玩测试钩子 ----------
  window.__e2e = {
    view: () => g.view,
    setAutoplay: (on) => { g.autoplay = on; autoBtn.classList.toggle('gold', on); },
    step: () => {
      const gv = g.view?.game;
      if (!gv || gv.win) return null;
      const a = g.policy.decide(gv, store.pid);
      if (a) dispatchPolicyAction(a);
      return a;
    },
    clearPending: () => clearPending(),
  };

  // R-9: 保存冒险卡片到故事集（localStorage）
  function saveAdventureCard(e) {
    try {
      const gv = g.view?.game;
      if (!gv || !gv.me) return;
      const me = gv.me, s = me.stats, w = gv.win;
      const highs = [];
      if (s.damageDealt > 0) highs.push('输出' + s.damageDealt + '伤害');
      if (s.kills > 0) highs.push('击杀' + s.kills + '名敌人');
      if (s.crits > 0) highs.push('暴击' + s.crits + '次');
      if (s.healed > 0) highs.push('治疗' + s.healed);
      if (s.rescues.length) highs.push('救出' + s.rescues.length + '名NPC');
      if (s.goldEarned > 0) highs.push('斩获' + s.goldEarned + '金币');
      if (s.bossLastHit) highs.push('亲手终结黑蜘蛛');
      const record = {
        id: Date.now() + '_' + Math.floor(Math.random() * 1e6),
        time: new Date().toLocaleString('zh-CN'),
        dungeon: g.view.room.dungeonName,
        persona: g.view.room.personaName,
        winKind: w.kind,
        duration: Math.round(w.duration / 60000),
        name: me.name,
        race: me.sheet.raceName,
        class: me.sheet.className,
        level: me.level,
        highlights: highs,
        rating: e.rating.rank,
        score: e.rating.score,
        comment: e.comment,
      };
      let cards = [];
      try { cards = JSON.parse(localStorage.getItem('dnd_cards') || '[]'); } catch (err) { cards = []; }
      if (!Array.isArray(cards)) cards = [];
      cards = cards.filter(c => c && c.id !== record.id);
      cards.unshift(record);
      localStorage.setItem('dnd_cards', JSON.stringify(cards.slice(0, 50)));
    } catch (err) { /* 存储失败静默 */ }
  }

  renderSide();
  renderOverlays(view);
  return {
    update,
    onEval: (e) => {
      g.cardEval = e;
      saveAdventureCard(e);
      renderOverlays(g.view);
    },
    unmount() { cancelAnimationFrame(raf); clearInterval(autoTicker); window.removeEventListener('resize', resize); if (resizeObserver) resizeObserver.disconnect(); window.__e2e = null; },
  };
}
