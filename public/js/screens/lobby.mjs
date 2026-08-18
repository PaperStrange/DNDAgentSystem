// 大厅：昵称 / 房间列表 / 创建房间（选副本+12位AI DM人设） / 加入房间 / 冒险者名册
import { store, el } from '../app.mjs';
import { loadRoster } from '../roster.mjs';
import { RACES, CLASSES } from '../../shared/char-defs.mjs';

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
  // B-13: 原「进入大厅」按钮在大厅内无实际作用且语义误导 → 改为「确认昵称」
  const nameBtn = el('button', 'btn primary', '确认昵称');
  nameBtn.title = '设置你的昵称并连接大厅（昵称可随时修改）';
  nameBtn.onclick = () => { const n = nameInput.value.trim(); if (n) { net.setName(n); store.name = n; nameBtn.textContent = '✓ 已确认'; setTimeout(() => { nameBtn.textContent = '确认昵称'; }, 1500); } };
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

  // R-10: 冒险故事集——藏书室样式（书架展示书籍，点开书籍查看评语+高光时刻配图）
  const storyPanel = el('div', 'panel');
  storyPanel.appendChild(el('h4', '', '📖 冒险故事集（藏书室）'));
  const loadCards = () => { try { const v = JSON.parse(localStorage.getItem('dnd_cards') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const storyCount = el('div', 'muted', '');
  const refreshCount = () => { const n = loadCards().length; storyCount.textContent = n ? '书架上有 ' + n + ' 本冒险传记，点击进入藏书室翻阅。' : '暂无冒险记录。完成一场冒险后，AI DM 会自动为你撰写传记并收入藏书室。'; };
  refreshCount();
  storyPanel.appendChild(storyCount);
  const enterBtn = el('button', 'btn gold', '🚪 进入藏书室');
  enterBtn.style.width = '100%';
  enterBtn.onclick = openLibrary;
  storyPanel.appendChild(enterBtn);
  left.appendChild(storyPanel);

  // 藏书室：书架 + 书籍翻开详情
  function openLibrary() {
    const cards = loadCards();
    const ov = el('div', 'overlay-screen library');
    const wrap = el('div', 'library-wrap');
    const head = el('div', 'library-head');
    head.appendChild(el('h2', '', '📖 冒险藏书室'));
    const close = el('button', 'btn small', '✕ 关闭');
    close.onclick = () => ov.remove();
    head.appendChild(close);
    wrap.appendChild(head);
    const shelf = el('div', 'shelf');
    if (!cards.length) {
      shelf.appendChild(el('div', 'muted', '书架上空空如也。完成一场冒险后，你的传记会自动出现在这里。'));
    }
    const rankColor = { S: '#e8c15a', A: '#d05a4a', B: '#6a8ad0', C: '#7ec97a', D: '#8a86a0' };
    for (const c of cards) {
      const book = el('div', 'book');
      book.style.background = 'linear-gradient(180deg, ' + (rankColor[c.rating] || '#8a86a0') + ' 0%, ' + (rankColor[c.rating] || '#8a86a0') + ' 14%, #241f30 15%, #2a2438 90%, #1a1626 100%)';
      const spine = el('div', 'book-spine', (c.winKind === 'defeat' ? '💀' : '🏆') + ' ' + c.name);
      spine.title = '《' + c.dungeon + '》· ' + c.name + ' · ' + c.rating + c.score + '分';
      book.appendChild(spine);
      book.onclick = () => openBook(c, ov);
      shelf.appendChild(book);
    }
    wrap.appendChild(shelf);
    ov.appendChild(wrap);
    document.body.appendChild(ov);
  }

  function openBook(c, parent) {
    const ov = el('div', 'overlay-screen book-open-overlay');
    const book = el('div', 'book-open');
    const pageL = el('div', 'book-page left');
    pageL.appendChild(el('h3', '', (c.winKind === 'defeat' ? '💀 折戟沉沙' : '🏆 凯旋而归') + ' · 《' + c.dungeon + '》'));
    pageL.appendChild(el('div', 'muted', c.time + ' · DM：' + c.persona + ' · 用时' + c.duration + '分钟'));
    pageL.appendChild(el('div', 'bp-line', '主角：' + c.name + '（' + c.race + ' ' + c.class + ' Lv' + c.level + '）'));
    pageL.appendChild(el('div', 'bp-line', '评分：' + c.rating + '（' + c.score + '分）'));
    const hl = el('div', 'bp-line');
    hl.appendChild(el('b', '', '高光时刻：'));
    hl.appendChild(document.createTextNode((c.highlights || []).join(' · ') || '平安是福'));
    pageL.appendChild(hl);
    const cm = el('div', 'book-comment');
    cm.appendChild(el('div', 'bc-label', 'DM 评语'));
    cm.appendChild(el('div', '', '「' + (c.comment || '这段冒险已成传说。') + '」'));
    pageL.appendChild(cm);
    book.appendChild(pageL);
    const pageR = el('div', 'book-page right');
    pageR.appendChild(el('div', 'bc-label', '高光时刻 · 纪念画'));
    if (c.art) {
      const img = document.createElement('img');
      img.src = c.art;
      img.className = 'book-art';
      pageR.appendChild(img);
    } else {
      pageR.appendChild(el('div', 'book-art placeholder muted', '（这本传记来自旧版本，暂无配画）'));
    }
    book.appendChild(pageR);
    ov.appendChild(book);
    const btnRow = el('div', 'row book-btns');
    const back = el('button', 'btn', '📚 回到书架');
    back.onclick = () => ov.remove();
    const del = el('button', 'btn small danger', '🗑 删除这本传记');
    del.onclick = () => {
      const all = loadCards().filter(x => x.id !== c.id);
      localStorage.setItem('dnd_cards', JSON.stringify(all));
      ov.remove();
      parent.remove();
      refreshCount();
      openLibrary();
    };
    btnRow.append(back, del);
    ov.appendChild(btnRow);
    document.body.appendChild(ov);
  }

  // R-11: 冒险者名册（已保存车卡 + 角色状态，阵亡角色禁战）
  const rosterPanel = el('div', 'panel');
  rosterPanel.appendChild(el('h4', '', '🧙 冒险者名册'));
  const rosterBox = el('div', 'story-list');
  const renderRoster = () => {
    rosterBox.innerHTML = '';
    const list = loadRoster();
    if (!list.length) {
      rosterBox.appendChild(el('div', 'muted', '暂无已保存的角色。进入房间完成车卡后会自动收入名册；角色阵亡后将被标记为「已阵亡」并禁止再次出战。'));
      return;
    }
    for (const e of list) {
      const item = el('div', 'story-item' + (e.status === 'dead' ? ' dead' : ''));
      const head = el('div', 'spread');
      const rn = RACES.find(r => r.id === e.raceId)?.name || e.raceId;
      const cn = CLASSES.find(c => c.id === e.classId)?.name || e.classId;
      head.appendChild(el('div', '', (e.status === 'dead' ? '☠️ ' : '🧙 ') + e.name + '（' + rn + '·' + cn + '）'));
      head.appendChild(el('span', 'badge' + (e.status === 'dead' ? '' : ' gold'), e.status === 'dead' ? '已阵亡' : '在世'));
      item.appendChild(head);
      item.appendChild(el('div', 'muted', new Date(e.updatedAt).toLocaleString('zh-CN') + (e.status === 'dead' ? ' · 该角色已无法参与新的冒险' : ' · 可在房间车卡界面读取')));
      rosterBox.appendChild(item);
    }
  };
  rosterPanel.appendChild(rosterBox);
  renderRoster();
  left.appendChild(rosterPanel);
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
  createBtn.title = '选择上方的AI DM人设后创建房间（房主可踢人）';
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
