// 房间：成员列表/踢人/车卡/准备。所有成员准备后自动开局
import { store, el, toast } from '../app.mjs';
import { RACES, CLASSES, MAX_STAT, MIN_STAT, POINT_POOL } from '../../shared/char-defs.mjs';
import { SKIN_TONES, HAIR_TONES, OUTFIT_TONES, spriteToCanvas } from '../pixel.mjs';

export function mountRoom(root, view) {
  const net = store.net;
  const me = view.me;
  const host = view.room.hostId;
  const room = view.room;

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
  const memberList = el('div', 'room-list');
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
  right.appendChild(el('h3', '', '📜 你的角色'));
  const chargen = mountChargen(right, view, net);
  let chargenRef = chargen;
  layout.appendChild(right);
  box.appendChild(layout);

  const foot = el('div', 'spread mt16');
  const readyState = el('div', 'muted', '全部成员准备后自动开局');
  const readyBtn = el('button', 'btn big gold', view.mySheet ? (view.members.find(m => m.pid === me.pid)?.ready ? '取消准备' : '✅ 准备就绪') : '请先完成车卡');
  readyBtn.disabled = !view.mySheet;
  readyBtn.onclick = () => {
    const cur = view.members.find(m => m.pid === me.pid)?.ready;
    net.send('room:ready', { ready: !cur });
  };
  foot.append(readyState, readyBtn);
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
  let colors = sheet ? { ...sheet.colors } : { skin: SKIN_TONES[0], hair: HAIR_TONES[0], outfit: OUTFIT_TONES[0] };
  let name = sheet ? sheet.name : '';
  let background = sheet ? sheet.background : '';
  let saved = !!view.mySheet;

  const race = () => RACES.find(r => r.id === selRace);
  const cls = () => CLASSES.find(c => c.id === selClass);

  const wrap = el('div', 'cg-wrap');
  const previewCanvas = el('canvas', '');
  previewCanvas.width = 16 * 6; previewCanvas.height = 18 * 6;
  const previewWrap = el('div', 'cg-preview');
  const previewLabel = el('div', 'preview-label', '👤 外观预览（种族·职业·配色）');
  previewWrap.appendChild(previewLabel);
  previewWrap.appendChild(previewCanvas);

  const cg = el('div', 'cg-layout');
  const mainCol = el('div', '');
  const sideCol = el('div', '');
  cg.append(mainCol, sideCol);

  const renderPreview = () => {
    const ctx = previewCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.fillStyle = '#181422';
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    const c = spriteToCanvas('player', 'human', { o: '#2a2430', s: colors.skin, h: colors.hair, u: colors.outfit, d: shade(colors.outfit), w: '#cfd6e4', e: '#f0f0f0' }, selClass, selRace);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 0, 0, 16 * 6, 18 * 6);
  };

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
  const classGrid = el('div', 'opt-grid');
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
  secBg.appendChild(el('h3', '', '⑥ 背景故事（一句话，可自由输入）'));
  const bgRow = el('div', '');
  bgRow.style.display = 'flex';
  bgRow.style.gap = '6px';
  const bgInput = el('textarea', '');
  bgInput.rows = 2;
  bgInput.style.cssText = 'flex:1;background:var(--panel2);border:2px solid var(--line);color:var(--txt);border-radius:6px;padding:8px;resize:vertical;';
  bgInput.placeholder = '写下角色的来历与梦想，或点击右侧按钮让AI DM为你即兴创作…';
  bgInput.value = background || '';
  bgInput.oninput = () => { background = bgInput.value.trim(); };
  bgRow.appendChild(bgInput);
  const randBgBtn = el('button', 'btn small gold', '🎲 随机');
  randBgBtn.title = '由AI DM根据角色的种族与职业即兴生成一句背景';
  randBgBtn.onclick = () => {
    if (!selRace || !selClass) { toast('请先选择种族与职业', true); return; }
    randBgBtn.disabled = true;
    randBgBtn.textContent = '⏳';
    net.send('room:bg-random', { raceId: selRace, classId: selClass, colors });
    setTimeout(() => { randBgBtn.disabled = false; randBgBtn.textContent = '🎲 随机'; }, 8000);
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
    net.send('room:charsheet', { sheet: { name, raceId: selRace, classId: selClass, stats: currentStats(), flex: flexObj, colors, background } });
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
  }

  function renderDerived() {
    derived.innerHTML = '';
    derived.appendChild(el('div', '', '📊 派生属性'));
    if (!stats || !selClass) { derived.appendChild(el('div', 'muted', '选择种族与职业后计算')); return; }
    const c = cls();
    const mods = Object.fromEntries(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(a => [a, statMod(stats[a] + (race().stats[a] || 0) + flexBonusOf(a))]));
    const hp = c.hitDie + mods.CON + (selRace === 'dwarf' ? 1 : 0);
    const ac = c.id === 'fighter' ? c.ac : c.ac + Math.min(mods.DEX, 2);
    const add = (k, v) => derived.appendChild(el('div', '', k + '：' + v));
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
    onBg: (text) => { bgInput.value = text; background = text; toast('✨ AI DM 已为你写下背景故事'); },
  };
}
