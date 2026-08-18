// 房间：成员列表/踢人/车卡/准备。所有成员准备后自动开局
import { store, el, toast } from '../app.mjs';
import { RACES, CLASSES, MAX_STAT, MIN_STAT, POINT_POOL } from '../../shared/char-defs.mjs';
import { SKIN_TONES, HAIR_TONES, OUTFIT_TONES, spriteToCanvas, spritePalette } from '../pixel.mjs';
// 捏脸扩展色板（R-13重做：瞳色/饰色）
const EYE_TONES = ['#3a6a9a', '#5b7a3a', '#8a5a2a', '#6a4a8a', '#3a3a4a', '#8a3a2a'];
const ACCENT_TONES = ['#c8a030', '#c05a5a', '#5a8ac0', '#7a5ac0', '#5ac0a0', '#d0c0c8'];
import { aliveEntries, upsertEntry, loadRoster } from '../roster.mjs';

export function mountRoom(root, view) {
  const net = store.net;
  const me = view.me;
  const host = view.room.hostId;
  const room = view.room;
  let lastView = view; // 供确认框读取最新成员数

  const box = el('div', 'screen-room');
  const head = el('div', 'room-head');
  const codeBox = el('div', '');
  codeBox.appendChild(el('div', 'muted', '房间码（告诉你的朋友）'));
  codeBox.appendChild(el('div', 'room-code', room.code));
  head.appendChild(codeBox);
  const info = el('div', '');
  info.appendChild(el('div', '', '🗺️ 《' + room.dungeonName + '》'));
  info.appendChild(el('div', 'muted', view.persona.avatar + ' AI DM：' + view.persona.name + '（' + view.persona.title + '）'));
  head.appendChild(info);
  const leaveBtn = el('button', 'btn danger', '离开房间');
  leaveBtn.onclick = () => net.send('room:leave');
  head.appendChild(leaveBtn);
  box.appendChild(head);

  const layout = el('div', 'room-layout');
  const left = el('div', '');
  left.appendChild(el('h3', '', '👥 冒险者（' + view.members.length + '/5）'));
  const memberList = el('div', 'member-grid');
  for (const m of view.members) {
    const card = el('div', 'panel member-card');
    card.appendChild(el('div', 'mc-icon', m.sheet ? (m.sheet.raceName === '人类' ? '🧑' : '🧝') : '❔'));
    const info2 = el('div', 'mc-info');
    info2.appendChild(el('div', 'mc-name', (m.isHost ? '👑 ' : '') + m.name + (m.isMe ? '（你）' : '') + (m.online ? '' : ' ⚠离线')));
    if (m.sheet) {
      const s = m.sheet;
      info2.appendChild(el('div', 'mc-sheet', s.raceName + ' · ' + s.className + ' · HP' + s.maxHp + ' · AC' + s.ac));
      info2.appendChild(el('div', 'stats-line', '力量' + s.stats.STR + ' 敏捷' + s.stats.DEX + ' 体质' + s.stats.CON + ' 智力' + s.stats.INT + ' 感知' + s.stats.WIS + ' 魅力' + s.stats.CHA));
    } else {
      info2.appendChild(el('div', 'mc-sheet', '尚未车卡'));
    }
    card.appendChild(info2);
    const ready = el('div', 'mc-ready' + (m.ready ? ' ok' : ''), m.ready ? '✅ 已准备' : '⏳ 车卡中');
    card.appendChild(ready);
    if (m.isHost === true && m.pid !== me.pid && me.pid === host) {
      const kick = el('button', 'btn small danger', '踢出');
      kick.onclick = () => net.send('room:kick', { targetPid: m.pid });
      card.appendChild(kick);
    }
    memberList.appendChild(card);
  }
  left.appendChild(memberList);
  layout.appendChild(left);

  // 右侧：车卡面板
  const right = el('div', 'panel');
  // R-14：车卡阶段可选择自动/手动战斗模式（房主设定，开局前生效）
  const modeBox = el('div', 'mode-box');
  modeBox.appendChild(el('h3', '', '⚔️ 战斗模式'));
  const seg = el('div', 'seg-row');
  const autoBtn = el('button', 'seg-btn' + (room.mode !== 'manual' ? ' sel' : ''), '🤖 自动战斗');
  const manBtn = el('button', 'seg-btn' + (room.mode === 'manual' ? ' sel' : ''), '🎲 手动战斗');
  const isHostMe = me.pid === host;
  autoBtn.disabled = !isHostMe;
  manBtn.disabled = !isHostMe;
  if (!isHostMe) { autoBtn.title = '战斗模式由房主设定'; manBtn.title = '战斗模式由房主设定'; }
  autoBtn.onclick = () => net.send('room:mode', { mode: 'auto' });
  manBtn.onclick = () => net.send('room:mode', { mode: 'manual' });
  seg.append(autoBtn, manBtn);
  modeBox.appendChild(seg);
  modeBox.appendChild(el('div', 'muted', isHostMe ? '自动：全自动战斗，支持倍速/暂停；手动：逐回合手动操作。开局前可随时切换。' : '由房主设定'));
  right.appendChild(modeBox);
  right.appendChild(el('h3', '', '📜 你的角色'));
  const chargen = mountChargen(right, view, net);
  let chargenRef = chargen;
  layout.appendChild(right);
  box.appendChild(layout);

  const foot = el('div', 'spread mt16');
  const readyState = el('div', 'muted', '全部成员准备后自动开局');
  const readyBtn = el('button', 'btn big gold', view.mySheet ? (view.members.find(m => m.pid === me.pid)?.ready ? '取消准备' : '✅ 准备就绪') : '请先完成车卡');
  readyBtn.disabled = !view.mySheet;
  // B-10：单人点击准备就绪时弹确认框——立即开始 或 继续等待队友
  readyBtn.onclick = () => {
    const members = lastView ? lastView.members : view.members;
    const cur = members.find(m => m.pid === me.pid)?.ready;
    if (!cur && members.length === 1) {
      showSoloReadyConfirm();
      return;
    }
    net.send('room:ready', { ready: !cur });
  };
  foot.append(readyState, readyBtn);

  function showSoloReadyConfirm() {
    const ov = el('div', 'dialog-overlay');
    const box = el('div', 'dialog-box');
    box.appendChild(el('h3', '', '🕯️ 孤身上路？'));
    box.appendChild(el('div', 'dg-greet', '队伍中目前只有你一人。现在就独自开始冒险，还是继续等待其他玩家加入？'));
    const go = el('button', 'btn gold', '⚔️ 立即开始冒险');
    go.style.cssText = 'width:100%;margin-bottom:6px;';
    go.onclick = () => {
      ov.remove();
      net.send('room:ready', { ready: true });
      net.send('room:start');
    };
    const wait = el('button', 'btn', '⏳ 继续等待其他玩家');
    wait.style.cssText = 'width:100%;margin-bottom:6px;';
    wait.onclick = () => { ov.remove(); net.send('room:ready', { ready: true }); };
    const back = el('button', 'btn', '🔙 返回房间');
    back.style.cssText = 'width:100%;';
    back.onclick = () => { ov.remove(); net.send('room:ready', { ready: false }); };
    box.append(go, wait, back);
    ov.appendChild(box);
    document.body.appendChild(ov);
  }
  box.appendChild(foot);
  root.appendChild(box);

  // 需要车卡时滚动到面板
  if (!view.mySheet) {
    setTimeout(() => {
      const inputs = box.querySelectorAll('.opt-card');
      if (inputs.length) inputs[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  }

  // 动态刷新：成员列表与准备按钮
  function renderMembers(v) {
    lastView = v;
    memberList.innerHTML = '';
    for (const m of v.members) {
      const card = el('div', 'panel member-card');
      card.appendChild(el('div', 'mc-icon', m.sheet ? (m.sheet.raceName === '人类' ? '🧑' : '🧝') : '❔'));
      const info2 = el('div', 'mc-info');
      info2.appendChild(el('div', 'mc-name', (m.isHost ? '👑 ' : '') + m.name + (m.isMe ? '（你）' : '') + (m.online ? '' : ' ⚠离线')));
      if (m.sheet) {
        const s = m.sheet;
        info2.appendChild(el('div', 'mc-sheet', s.raceName + ' · ' + s.className + ' · HP' + s.maxHp + ' · AC' + s.ac));
        info2.appendChild(el('div', 'stats-line', '力量' + s.stats.STR + ' 敏捷' + s.stats.DEX + ' 体质' + s.stats.CON + ' 智力' + s.stats.INT + ' 感知' + s.stats.WIS + ' 魅力' + s.stats.CHA));
      } else {
        info2.appendChild(el('div', 'mc-sheet', '尚未车卡'));
      }
      card.appendChild(info2);
      const ready = el('div', 'mc-ready' + (m.ready ? ' ok' : ''), m.ready ? '✅ 已准备' : '⏳ 车卡中');
      card.appendChild(ready);
      if (m.isHost === true && m.pid !== v.me.pid && v.me.pid === v.room.hostId) {
        const kick = el('button', 'btn small danger', '踢出');
        kick.onclick = () => net.send('room:kick', { targetPid: m.pid });
        card.appendChild(kick);
      }
      memberList.appendChild(card);
    }
    const myM = v.members.find(m => m.pid === v.me.pid);
    readyBtn.textContent = v.mySheet ? (myM?.ready ? '取消准备' : '✅ 准备就绪') : '请先完成车卡';
    readyBtn.disabled = !v.mySheet;
    readyState.textContent = v.members.length === 1 ? '当前仅你一人：准备后需确认开始，或等待队友加入' : '全部成员准备后自动开局';
    autoBtn.classList.toggle('sel', v.room.mode !== 'manual');
    manBtn.classList.toggle('sel', v.room.mode === 'manual');
    // B-6: 保存成功检测（mySheet从无到有）
    if (!hadSheet && v.mySheet) toast('✅ 车卡已保存');
    hadSheet = !!v.mySheet;
  }

  let hadSheet = !!view.mySheet;
  return {
    update(v) { renderMembers(v); },
    onBg: (text) => { if (chargenRef) chargenRef.onBg(text); },
  };
}

// ---------- 车卡 ----------
export function mountChargen(root, view, net) {
  const me = view.me;
  let sheet = view.mySheet ? { name: view.mySheet.name, raceId: view.mySheet.race, classId: view.mySheet.class, stats: { ...view.mySheet.stats }, flex: {}, colors: { ...view.mySheet.colors }, background: view.mySheet.background } : null;
  if (view.mySheet) {
    // 反推flex（简化：清空，重新选择）
    sheet.flex = {};
  }
  let selRace = sheet ? sheet.raceId : null;
  let selClass = sheet ? sheet.classId : null;
  let stats = sheet ? { ...sheet.stats } : null;
  let flexList = []; // 自由加点：按槽位存储属性分配（如 ['STR','CON']），互不干扰
  let colors = sheet ? { ...sheet.colors } : { skin: SKIN_TONES[0], hair: HAIR_TONES[0], outfit: OUTFIT_TONES[0], eye: EYE_TONES[0], accent: ACCENT_TONES[0] };
  let look = sheet ? { ...(sheet.look || {}) } : { hair: 0, beard: 0 }; // 捏脸：发型/胡须
  let carryLevel = sheet ? (sheet.level || 1) : 1; // 跨冒险继承的等级
  let carryXp = sheet ? (sheet.xp || 0) : 0; // 跨冒险继承的经验
  let name = sheet ? sheet.name : '';
  let background = sheet ? sheet.background : '';
  let saved = !!view.mySheet;
  // R-11: 载入的角色条目id（阵亡角色不可载入）；已有车卡按同名在世条目衔接，避免重复建档
  let loadedId = null;
  if (view.mySheet) {
    const existing = loadRoster().find(x => x.name === view.mySheet.name && x.status !== 'dead');
    if (existing) loadedId = existing.id;
  }

  const race = () => RACES.find(r => r.id === selRace);
  const cls = () => CLASSES.find(c => c.id === selClass);

  const wrap = el('div', 'cg-wrap');
  const previewCanvas = el('canvas', '');
  previewCanvas.width = 16 * 8; previewCanvas.height = 18 * 8; // R-13: 提高内部分辨率，轮廓更清晰
  const previewWrap = el('div', 'cg-preview');
  const previewLabel = el('div', 'preview-label', '👤 外观预览（种族·职业·配色）');
  previewWrap.appendChild(previewLabel);
  previewWrap.appendChild(previewCanvas);

  const cg = el('div', 'cg-layout');
  const mainCol = el('div', 'cg-main');
  const sideCol = el('div', 'cg-side');
  cg.append(mainCol, sideCol);

  const renderPreview = () => {
    const ctx = previewCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.fillStyle = '#181422';
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    const pal = spritePalette('player', 'human', colors);
    pal.e = colors.eye; pal.U = colors.accent; // 捏脸：瞳色+饰色
    const c = spriteToCanvas('player', 'human', pal, selClass, selRace, look);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 0, 0, 16 * 8, 18 * 8);
  };

  // R-11: 读取已保存的在世角色（已阵亡角色不列出 → 禁止出战）
  const secRoster = el('div', 'cg-section');
  secRoster.appendChild(el('h3', '', '📖 读取已保存角色'));
  const rosterSel = document.createElement('select');
  rosterSel.style.cssText = 'width:100%;background:var(--panel2);border:2px solid var(--line);color:var(--txt);border-radius:6px;padding:8px;';
  const rosterDeadHint = el('div', 'muted', '');
  secRoster.appendChild(rosterDeadHint);
  secRoster.appendChild(rosterSel);
  const refreshRosterSel = () => {
    const alive = aliveEntries();
    const dead = loadRoster().filter(x => x.status === 'dead').length;
    rosterSel.innerHTML = '';
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = alive.length ? '—— 选择一名角色载入（' + alive.length + '位可用）——' : '—— 暂无可用角色 ——';
    rosterSel.appendChild(defOpt);
    for (const e of alive) {
      const o = document.createElement('option');
      o.value = e.id;
      const rn = RACES.find(r => r.id === e.raceId)?.name || e.raceId;
      const cn = CLASSES.find(c => c.id === e.classId)?.name || e.classId;
      o.textContent = e.name + '（' + rn + '·' + cn + (e.level > 1 ? '·Lv' + e.level : '') + '）';
      rosterSel.appendChild(o);
    }
    rosterDeadHint.textContent = dead ? '☠️ ' + dead + ' 位角色已阵亡，无法再次出战（请在名册中查看）' : '';
  };
  rosterSel.onchange = () => {
    const e = loadRoster().find(x => x.id === rosterSel.value);
    if (!e) return;
    loadedId = e.id;
    name = e.name; nameInput.value = e.name;
    selRace = e.raceId; selClass = e.classId;
    stats = e.stats ? { ...e.stats } : null;
    flexList = e.flex ? Object.keys(e.flex).flatMap(a => Array(Math.min(6, e.flex[a] || 0)).fill(a)) : [];
    colors = { ...(e.colors || { skin: SKIN_TONES[0], hair: HAIR_TONES[0], outfit: OUTFIT_TONES[0], eye: EYE_TONES[0], accent: ACCENT_TONES[0] }) };
    look = { ...(e.look || { hair: 0, beard: 0 }) };
    carryLevel = e.level || 1;
    carryXp = e.xp || 0;
    background = e.background || '';
    bgInput.value = background;
    sync();
    toast('📖 已载入角色「' + e.name + '」');
  };
  refreshRosterSel();
  mainCol.appendChild(secRoster);

  // 名字
  const secName = el('div', 'cg-section');
  secName.appendChild(el('h3', '', '① 名字'));
  const nameInput = el('input', '');
  nameInput.style.cssText = 'width:100%;background:var(--panel2);border:2px solid var(--line);color:var(--txt);border-radius:6px;padding:8px 10px;';
  nameInput.placeholder = '为你的角色起个名字';
  nameInput.value = name;
  nameInput.oninput = () => { name = nameInput.value.trim(); };
  secName.appendChild(nameInput);
  mainCol.appendChild(secName);

  // 种族
  const secRace = el('div', 'cg-section');
  secRace.appendChild(el('h3', '', '② 选择种族（' + RACES.length + '种）'));
  const raceGrid = el('div', 'opt-grid');
  for (const r of RACES) {
    const card = el('div', 'opt-card');
    card.appendChild(el('div', 'oc-name', r.icon + ' ' + r.name));
    card.appendChild(el('div', 'oc-sub', r.features.map(f => f.name).join(' / ')));
    card.onclick = () => { selRace = r.id; selClass = selClass || 'fighter'; stats = null; sync(); };
    raceGrid.appendChild(card);
  }
  secRace.appendChild(raceGrid);
  mainCol.appendChild(secRace);

  // 职业
  const secClass = el('div', 'cg-section');
  secClass.appendChild(el('h3', '', '③ 选择职业（' + CLASSES.length + '种）'));
  const classGrid = el('div', 'opt-grid cols3');
  for (const c of CLASSES) {
    const card = el('div', 'opt-card');
    card.appendChild(el('div', 'oc-name', c.icon + ' ' + c.name));
    card.appendChild(el('div', 'oc-sub', 'HP骰d' + c.hitDie + ' · AC' + c.ac + ' · ' + c.weapons[0].name));
    card.onclick = () => { selClass = c.id; stats = null; sync(); };
    classGrid.appendChild(card);
  }
  secClass.appendChild(classGrid);
  mainCol.appendChild(secClass);

  // 属性
  const secStats = el('div', 'cg-section');
  secStats.appendChild(el('h3', '', '④ 分配属性（线性购点，上限' + MAX_STAT + '）'));
  const poolInfo = el('div', 'pool-info');
  const statBox = el('div', '');
  secStats.append(poolInfo, statBox);
  mainCol.appendChild(secStats);

  // 外观
  const secLook = el('div', 'cg-section');
  secLook.appendChild(el('h3', '', '⑤ 外观'));
  const lookBox = el('div', '');
  secLook.appendChild(lookBox);
  mainCol.appendChild(secLook);

  // 背景（R-2：自由输入 + LLM随机生成）
  const secBg = el('div', 'cg-section');
  secBg.appendChild(el('h3', '', '⑥ 背景故事'));
  const bgRow = el('div', '');
  bgRow.style.display = 'flex';
  bgRow.style.gap = '6px';
  const bgInput = el('textarea', '');
  bgInput.rows = 4;
  bgInput.style.cssText = 'flex:1;background:var(--panel2);border:2px solid var(--line);color:var(--txt);border-radius:6px;padding:8px;resize:vertical;';
  bgInput.placeholder = '写下角色的来历与梦想，或点击右侧按钮随机生成一段故事…';
  bgInput.value = background || '';
  bgInput.oninput = () => { background = bgInput.value.trim(); };
  bgRow.appendChild(bgInput);
  const randBgBtn = el('button', 'btn small gold', '🎲 随机');
  randBgBtn.title = '随机生成一段背景故事（150字以上）';
  randBgBtn.onclick = () => {
    if (!selRace || !selClass) { toast('请先选择种族与职业', true); return; }
    randBgBtn.disabled = true;
    randBgBtn.innerHTML = '<span class="spin"></span> 生成中…';
    net.send('room:bg-random', { raceId: selRace, classId: selClass, colors });
    setTimeout(() => { randBgBtn.disabled = false; randBgBtn.innerHTML = '🎲 随机'; }, 30000);
  };
  bgRow.appendChild(randBgBtn);
  secBg.appendChild(bgRow);
  mainCol.appendChild(secBg);

  sideCol.appendChild(previewWrap);
  const derived = el('div', 'panel derived-list');
  sideCol.appendChild(derived);

  // 保存
  const saveBtn = el('button', 'btn primary big', '💾 保存车卡');
  saveBtn.style.width = '100%';
  saveBtn.disabled = !selRace || !selClass;
  saveBtn.onclick = () => {
    if (!name) { nameInput.focus(); toast('请先为角色起名', true); return; }
    if (!selRace || !selClass) { toast('请先选择种族与职业', true); return; }
    const flexObj = {};
    for (const a of flexList) flexObj[a] = (flexObj[a] || 0) + 1;
    // R-11: 保存车卡同时收入冒险者名册（载入的角色原地更新），并刷新读取列表
    loadedId = upsertEntry({ name, raceId: selRace, classId: selClass, stats: currentStats(), flex: flexObj, colors, background, look, level: carryLevel, xp: carryXp }, loadedId);
    refreshRosterSel();
    net.send('room:charsheet', { sheet: { name, raceId: selRace, classId: selClass, stats: currentStats(), flex: flexObj, colors, background, look, level: carryLevel, xp: carryXp } });
    toast('⏳ 正在保存车卡…');
  };
  const saveWrap = el('div', 'mt8');
  saveWrap.appendChild(saveBtn);
  mainCol.appendChild(saveWrap);

  function currentStats() { return stats; }
  function statMod(v) { return Math.floor((v - 10) / 2); }
  function usedPoints() { return stats ? Object.values(stats).reduce((a, v) => a + (v - MIN_STAT), 0) : 0; }

  function sync() {
    // 选中状态
    raceGrid.querySelectorAll('.opt-card').forEach(c => c.classList.toggle('sel', false));
    classGrid.querySelectorAll('.opt-card').forEach(c => c.classList.toggle('sel', false));
    if (selRace) { const cards = raceGrid.querySelectorAll('.opt-card'); const idx = RACES.findIndex(r => r.id === selRace); cards[idx] && cards[idx].classList.add('sel'); }
    if (selClass) { const cards = classGrid.querySelectorAll('.opt-card'); const idx = CLASSES.findIndex(c => c.id === selClass); cards[idx] && cards[idx].classList.add('sel'); }
    if (selRace && selClass && !stats) {
      // 默认分配：主属性高
      const cls2 = cls();
      stats = { STR: 10, DEX: 10, CON: 12, INT: 10, WIS: 10, CHA: 10 };
      stats[cls2.main] = 15;
      const second = cls2.main === 'STR' ? 'CON' : (cls2.main === 'DEX' ? 'CON' : 'DEX');
      stats[second] = 14;
      stats.CON = 13;
      let used = 0;
      for (const k of Object.keys(stats)) used += stats[k] - MIN_STAT;
      if (used > POINT_POOL) { const keys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].filter(k => k !== cls2.main); for (const k of keys) { while (used > POINT_POOL && stats[k] > MIN_STAT) { stats[k]--; used--; } } }
      // 自由加点槽位默认：主属性+体质（与种族flex数量对应）
      flexList = [];
      while (flexList.length < race().flex) flexList.push(flexList.length === 0 ? cls2.main : 'CON');
    }
    renderStatRows();
    renderLook();
    renderPreview();
    renderDerived();
    saveBtn.disabled = !selRace || !selClass || !name;
  }

  function flexBonusOf(a) { return flexList.filter(x => x === a).length; }
  function renderStatRows() {
    poolInfo.textContent = '剩余点数：' + (POINT_POOL - usedPoints()) + ' / ' + POINT_POOL + '（基础值下限' + MIN_STAT + '、上限' + MAX_STAT + '；种族加成与自由加点不计入购点）';
    statBox.innerHTML = '';
    if (!stats) { statBox.appendChild(el('div', 'muted', '请先选择种族与职业')); return; }
    const names = { STR: '力量', DEX: '敏捷', CON: '体质', INT: '智力', WIS: '感知', CHA: '魅力' };
    for (const a of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
      const racial = race().stats[a] || 0;
      const flexBonus = flexBonusOf(a);
      const final = stats[a] + racial + flexBonus;
      const row = el('div', 'stat-row');
      row.appendChild(el('label', '', names[a]));
      // 边界禁用：明确限制可减/可加范围
      const minus = el('button', 'btn small', '−');
      minus.disabled = stats[a] <= MIN_STAT;
      minus.title = stats[a] <= MIN_STAT ? '已达下限' + MIN_STAT : '降低1点（退还1点）';
      minus.onclick = () => { if (stats[a] > MIN_STAT) { stats[a]--; renderStatRows(); renderDerived(); } };
      const plus = el('button', 'btn small', '＋');
      plus.disabled = stats[a] >= MAX_STAT || usedPoints() >= POINT_POOL;
      plus.title = stats[a] >= MAX_STAT ? '已达上限' + MAX_STAT : (usedPoints() >= POINT_POOL ? '点数已用完' : '增加1点（消耗1点）');
      plus.onclick = () => { if (stats[a] < MAX_STAT && usedPoints() < POINT_POOL) { stats[a]++; renderStatRows(); renderDerived(); } };
      // 数值展示：基础值 + 加成明细 + 最终调整值
      const val = el('div', 'sr-val');
      val.textContent = stats[a];
      const bonus = racial + flexBonus;
      if (bonus > 0) {
        const b = el('span', 'sr-bonus', '+' + bonus + (racial ? '（种族' + (racial > 0 ? '+' : '') + racial + '）' : '') + (flexBonus ? '（自由+' + flexBonus + '）' : ''));
        val.appendChild(b);
      }
      const modEl = el('div', 'sr-mod', (final >= 10 ? '+' : '') + statMod(final) + ' → ' + final);
      const bar = el('div', 'sr-bar');
      const fill = el('div', 'sr-fill');
      fill.style.width = ((stats[a] - MIN_STAT) / (MAX_STAT - MIN_STAT) * 100) + '%';
      bar.appendChild(fill);
      row.append(minus, val, plus, bar, modEl);
      statBox.appendChild(row);
    }
    // 种族自由加点：每个槽位独立选择，互不影响
    if (race().flex > 0) {
      while (flexList.length < race().flex) flexList.push('CON');
      if (flexList.length > race().flex) flexList.length = race().flex;
      const flexRow = el('div', 'stat-row');
      flexRow.appendChild(el('label', '', '自由加点'));
      const all = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
      for (let i = 0; i < race().flex; i++) {
        const sel = document.createElement('select');
        sel.style.cssText = 'background:var(--panel2);border:2px solid var(--line);color:var(--txt);border-radius:6px;padding:4px;margin-left:6px;';
        for (const a of all) {
          const o = document.createElement('option');
          o.value = a; o.textContent = names[a];
          sel.appendChild(o);
        }
        sel.value = flexList[i];
        sel.onchange = () => { flexList[i] = sel.value; renderStatRows(); renderDerived(); };
        flexRow.appendChild(sel);
      }
      statBox.appendChild(flexRow);
    }
  }

  function renderLook() {
    lookBox.innerHTML = '';
    const row1 = el('div', 'color-row');
    row1.appendChild(el('span', 'muted', '肤色'));
    for (const c of SKIN_TONES) {
      const sw = el('div', 'color-swatch');
      sw.style.background = c;
      if (colors.skin === c) sw.classList.add('sel');
      sw.onclick = () => { colors.skin = c; renderLook(); renderPreview(); };
      row1.appendChild(sw);
    }
    lookBox.appendChild(row1);
    const row2 = el('div', 'color-row mt8');
    row2.appendChild(el('span', 'muted', '发色'));
    for (const c of HAIR_TONES) {
      const sw = el('div', 'color-swatch');
      sw.style.background = c;
      if (colors.hair === c) sw.classList.add('sel');
      sw.onclick = () => { colors.hair = c; renderLook(); renderPreview(); };
      row2.appendChild(sw);
    }
    lookBox.appendChild(row2);
    const row3 = el('div', 'color-row mt8');
    row3.appendChild(el('span', 'muted', '服色'));
    for (const c of OUTFIT_TONES) {
      const sw = el('div', 'color-swatch');
      sw.style.background = c;
      if (colors.outfit === c) sw.classList.add('sel');
      sw.onclick = () => { colors.outfit = c; renderLook(); renderPreview(); };
      row3.appendChild(sw);
    }
    lookBox.appendChild(row3);
    // R-13重做：瞳色
    const row4 = el('div', 'color-row mt8');
    row4.appendChild(el('span', 'muted', '瞳色'));
    for (const c of EYE_TONES) {
      const sw = el('div', 'color-swatch');
      sw.style.background = c;
      if (colors.eye === c) sw.classList.add('sel');
      sw.onclick = () => { colors.eye = c; renderLook(); renderPreview(); };
      row4.appendChild(sw);
    }
    lookBox.appendChild(row4);
    // R-13重做：饰色（服装高光/金属件）
    const row5 = el('div', 'color-row mt8');
    row5.appendChild(el('span', 'muted', '饰色'));
    for (const c of ACCENT_TONES) {
      const sw = el('div', 'color-swatch');
      sw.style.background = c;
      if (colors.accent === c) sw.classList.add('sel');
      sw.onclick = () => { colors.accent = c; renderLook(); renderPreview(); };
      row5.appendChild(sw);
    }
    lookBox.appendChild(row5);
    // R-13重做：发型
    const hairRow = el('div', 'color-row mt8');
    hairRow.appendChild(el('span', 'muted', '发型'));
    const HAIR_STYLES = ['默认', '长发', '发髻', '短发'];
    HAIR_STYLES.forEach((label, i) => {
      const b = el('button', 'btn small' + (look.hair === i ? ' gold' : ''), label);
      b.onclick = () => { look.hair = i; renderLook(); renderPreview(); };
      hairRow.appendChild(b);
    });
    lookBox.appendChild(hairRow);
    // R-13重做：胡须
    const beardRow = el('div', 'color-row mt8');
    beardRow.appendChild(el('span', 'muted', '胡须'));
    ['无', '有'].forEach((label, i) => {
      const b = el('button', 'btn small' + (look.beard === i ? ' gold' : ''), label);
      b.onclick = () => { look.beard = i; renderLook(); renderPreview(); };
      beardRow.appendChild(b);
    });
    lookBox.appendChild(beardRow);
    // 随机外观
    const rndRow = el('div', 'mt8');
    const rndBtn = el('button', 'btn small gold', '🎲 随机外观');
    rndBtn.title = '随机生成一套完整外观（肤色/发色/服色/瞳色/饰色/发型/胡须）';
    rndBtn.onclick = () => {
      colors.skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
      colors.hair = HAIR_TONES[Math.floor(Math.random() * HAIR_TONES.length)];
      colors.outfit = OUTFIT_TONES[Math.floor(Math.random() * OUTFIT_TONES.length)];
      colors.eye = EYE_TONES[Math.floor(Math.random() * EYE_TONES.length)];
      colors.accent = ACCENT_TONES[Math.floor(Math.random() * ACCENT_TONES.length)];
      look.hair = Math.floor(Math.random() * 4);
      look.beard = Math.floor(Math.random() * 2);
      renderLook(); renderPreview();
    };
    rndRow.appendChild(rndBtn);
    lookBox.appendChild(rndRow);
  }

  function renderDerived() {
    derived.innerHTML = '';
    derived.appendChild(el('div', '', '📊 派生属性'));
    if (!stats || !selClass) { derived.appendChild(el('div', 'muted', '选择种族与职业后计算')); return; }
    const c = cls();
    const mods = Object.fromEntries(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(a => [a, statMod(stats[a] + (race().stats[a] || 0) + flexBonusOf(a))]));
    const lv = Math.max(1, carryLevel);
    const hp = c.hitDie + mods.CON + (selRace === 'dwarf' ? 1 : 0) + (lv - 1) * (c.hpPerLv + mods.CON + (selRace === 'dwarf' ? 1 : 0));
    const ac = c.id === 'fighter' ? c.ac : c.ac + Math.min(mods.DEX, 2);
    const add = (k, v) => derived.appendChild(el('div', '', k + '：' + v));
    add('等级', '<b>Lv' + lv + '</b>' + (lv > 1 ? '（继承自上次冒险）' : '') + ' · 经验 ' + carryXp);
    add('生命值', '<b>' + hp + '</b>');
    add('护甲AC', '<b>' + ac + '</b>');
    add('攻击加值', '<b>+' + (2 + mods[c.main] + (c.id === 'fighter' ? 1 : 0)) + '</b>');
    add('先攻', '<b>+' + mods.DEX + '</b>');
    add('移动', '<b>' + race().speed + '格</b>');
    const feats = [...c.features.map(f => f.name), ...race().features.map(f => f.name)];
    add('特性', '<b>' + feats.join('、') + '</b>');
    add('种族', '<b>' + race().name + '</b>');
    add('职业', '<b>' + c.name + '</b>');
  }

  function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, ((n >> 16) & 255) - 40), g = Math.max(0, ((n >> 8) & 255) - 40), b = Math.max(0, (n & 255) - 40);
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  root.appendChild(wrap);
  wrap.append(cg);
  sync();
  return {
    update() {},
    onBg: (text) => { bgInput.value = text; background = text; randBgBtn.disabled = false; randBgBtn.innerHTML = '🎲 随机'; toast('✨ 已为你写下背景故事'); },
  };
}
