// 大厅：昵称 / 房间列表 / 创建房间（选副本+12位AI DM人设） / 加入房间
import { store, el } from '../app.mjs';

export function mountLobby(root, view) {
  const net = store.net;
  let selPersona = null, selDungeon = null;

  const box = el('div', 'screen-lobby');
  const head = el('div', 'lobby-head');
  const title = el('div', 'lobby-title');
  title.innerHTML = '🎲 骰与篝火<small>AI DM · 像素跑团 · 凡杜尔失落矿坑</small>';
  head.appendChild(title);
  const nameBox = el('div', 'name-box');
  const nameInput = el('input', '');
  nameInput.value = store.name || '';
  nameInput.placeholder = '你的昵称';
  const nameBtn = el('button', 'btn primary', '进入');
  nameBtn.onclick = () => { const n = nameInput.value.trim(); if (n) { net.setName(n); store.name = n; } };
  nameBox.append(nameInput, nameBtn);
  head.appendChild(nameBox);
  box.appendChild(head);

  const grid = el('div', 'lobby-grid');

  // 左侧：房间列表 + 加入
  const left = el('div', '');
  const joinBox = el('div', 'join-box');
  const codeInput = el('input', '');
  codeInput.placeholder = '房间码，如 AB3CD';
  codeInput.maxLength = 5;
  const joinBtn = el('button', 'btn gold', '加入房间');
  joinBtn.onclick = () => { const c = codeInput.value.trim().toUpperCase(); if (c) net.send('lobby:join', { code: c }); };
  joinBox.append(codeInput, joinBtn);
  left.appendChild(joinBox);
  const roomList = el('div', 'room-list');
  if (!view.rooms.length) roomList.appendChild(el('div', 'panel muted', '暂无进行中的房间，创建一间吧！'));
  for (const r of view.rooms) {
    const card = el('div', 'panel room-card');
    const rcL = el('div', 'rc-left');
    rcL.appendChild(el('b', '', r.code));
    rcL.appendChild(el('span', '', r.hostName + ' 的房间'));
    rcL.appendChild(el('div', 'rc-dim', '《' + r.dungeonName + '》 · DM：' + r.personaName + ' · ' + (r.phase === 'prepare' ? '准备中' : '游戏中')));
    card.appendChild(rcL);
    const rcR = el('div', 'rc-dim', r.members + '/' + r.max + ' 人');
    card.appendChild(rcR);
    if (r.phase === 'prepare') {
      const btn = el('button', 'btn small', '加入');
      btn.onclick = () => net.send('lobby:join', { code: r.code });
      card.appendChild(btn);
    }
    roomList.appendChild(card);
  }
  left.appendChild(roomList);
  grid.appendChild(left);

  // 右侧：创建房间
  const right = el('div', 'create-box panel');
  right.appendChild(el('h3', '', '⚔️ 创建房间'));
  const dg = view.dungeons[0];
  selDungeon = dg.id;
  const dc = el('div', 'panel dungeon-card');
  dc.appendChild(el('b', '', dg.icon + ' 《' + dg.name + '》'));
  dc.appendChild(el('div', 'dc-desc', dg.desc));
  dc.appendChild(el('div', 'dc-desc', dg.publicGoal));
  right.appendChild(dc);
  right.appendChild(el('h4', '', '选择你的AI DM（' + view.personas.length + '位人设）'));
  const pg = el('div', 'persona-grid');
  for (const p of view.personas) {
    const card = el('div', 'persona-card');
    const pcHead = el('div', 'pc-head');
    pcHead.appendChild(el('span', 'pc-avatar', p.avatar));
    const pcInfo = el('div', '');
    pcInfo.appendChild(el('div', 'pc-name', p.name));
    pcInfo.appendChild(el('div', 'pc-title', p.title));
    pcHead.appendChild(pcInfo);
    card.appendChild(pcHead);
    card.appendChild(el('div', 'pc-tag', '“' + p.tagline + '”'));
    const stats = el('div', 'pc-stats');
    stats.appendChild(el('span', '', '规则' + '★'.repeat(p.stats.strict)));
    stats.appendChild(el('span', '', '难度' + '★'.repeat(p.stats.difficulty)));
    stats.appendChild(el('span', '', '戏剧' + '★'.repeat(p.stats.drama)));
    card.appendChild(stats);
    card.onclick = () => {
      selPersona = p.id;
      pg.querySelectorAll('.persona-card').forEach(c => c.classList.remove('sel'));
      card.classList.add('sel');
      createBtn.disabled = false;
    };
    pg.appendChild(card);
  }
  right.appendChild(pg);
  const createBtn = el('button', 'btn gold big mt8', '创建房间并成为房主');
  createBtn.style.width = '100%';
  createBtn.disabled = true;
  createBtn.onclick = () => {
    if (!store.name) { nameInput.focus(); return; }
    if (!selPersona) return;
    net.setName(store.name || nameInput.value.trim());
    net.send('lobby:create', { dungeonId: selDungeon, personaId: selPersona });
  };
  right.appendChild(createBtn);
  grid.appendChild(right);
  box.appendChild(grid);
  root.appendChild(box);

  function renderRooms(v) {
    roomList.innerHTML = '';
    if (!v.rooms.length) roomList.appendChild(el('div', 'panel muted', '暂无进行中的房间，创建一间吧！'));
    for (const r of v.rooms) {
      const card = el('div', 'panel room-card');
      const rcL = el('div', 'rc-left');
      rcL.appendChild(el('b', '', r.code));
      rcL.appendChild(el('span', '', r.hostName + ' 的房间'));
      rcL.appendChild(el('div', 'rc-dim', '《' + r.dungeonName + '》 · DM：' + r.personaName + ' · ' + (r.phase === 'prepare' ? '准备中' : '游戏中')));
      card.appendChild(rcL);
      const rcR = el('div', 'rc-dim', r.members + '/' + r.max + ' 人');
      card.appendChild(rcR);
      if (r.phase === 'prepare') {
        const btn = el('button', 'btn small', '加入');
        btn.onclick = () => net.send('lobby:join', { code: r.code });
        card.appendChild(btn);
      }
      roomList.appendChild(card);
    }
  }
  return { update(v) { renderRooms(v); } };
}
