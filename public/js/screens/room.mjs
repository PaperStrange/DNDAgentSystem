// 房间：成员列表/踢人/车卡/准备。所有成员准备后自动开局
import { store, el, toast } from '../app.mjs';
import { RACES, CLASSES, MAX_STAT, MIN_STAT, POINT_POOL } from '../../shared/char-defs.mjs';
import { SKIN_TONES, HAIR_TONES, OUTFIT_TONES, EYE_TONES, ACCENT_TONES, spriteToCanvas, spritePalette } from '../pixel.mjs';
import { aliveEntries, upsertEntry, loadRoster } from '../roster.mjs';
import { portraitUrl } from '../portraits.mjs';

export function mountRoom(root, view) {
  const net = store.net;
  const me = view.me;
  const host = view.room.hostId;
  const room = view.room;
  let lastView = view; // 供确认框读取最新成员数

  // S2-1：成员卡头像接入种族定稿立绘（展示层；加载失败回退原 emoji，不阻塞房间功能）
  const memberIcon = (m) => {
    const url = m.sheet ? portraitUrl(m.sheet.race) : null;
    if (url) {
      const img = el('img', 'mc-icon mc-portrait');
      img.alt = m.sheet.raceName || '';
      img.onerror = () => { img.replaceWith(el('div', 'mc-icon', m.sheet.raceName === '人类' ? '🧑' : '🧝')); };
      img.src = url;
      return img;
    }
    return el('div', 'mc-icon', m.sheet ? (m.sheet.raceName === '人类' ? '🧑' : '🧝') : '❔');
  };

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
    card.appendChild(memberIcon(m));
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
      card.appendChild(memberIcon(m));
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
  let look = sheet ? { hair: 0, beard: 0, brow: 0, mouth: 0, marking: 0, ...(sheet.look || {}) } : { hair: 0, beard: 0, brow: 0, mouth: 0, marking: 0 };
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
  // S1-2：预览画布升级 200×240（12倍缩放），纯色深底
  previewCanvas.width = 12 * 16; previewCanvas.height = 12 * 18;
  const previewWrap = el('div', 'cg-preview');
  const previewLabel = el('div', 'preview-label', '外观预览');
  previewWrap.appendChild(previewLabel);
  previewWrap.appendChild(previewCanvas);
  // S1-2：面部放大窗口
  const faceZoomCanvas = el('canvas', '');
  faceZoomCanvas.width = 12 * 8; faceZoomCanvas.height = 12 * 8;
  const faceZoomWrap = el('div', 'face-zoom-wrap');
  faceZoomWrap.appendChild(el('div', 'face-zoom-label', '面部细节'));
  faceZoomWrap.appendChild(faceZoomCanvas);
  previewWrap.appendChild(faceZoomWrap);
  // S2-1：种族立绘展示层——老板终选 wan 档定稿，随所选种族切换；冒险/战斗内小人仍走程序化像素 sprite
  const portraitWrap = el('div', 'cg-portrait-wrap');
  portraitWrap.appendChild(el('div', 'cg-portrait-label', '种族立绘'));
  const portraitEmpty = el('div', 'cg-portrait-empty', '选择种族后展示立绘');
  const portraitImg = el('img', 'cg-portrait');
  portraitImg.alt = '';
  portraitImg.style.display = 'none';
  portraitImg.onerror = () => { portraitImg.style.display = 'none'; portraitEmpty.style.display = ''; };
  portraitWrap.append(portraitImg, portraitEmpty);
  previewWrap.appendChild(portraitWrap);

  const cg = el('div', 'cg-layout');
  const mainCol = el('div', 'cg-main');
  const sideCol = el('div', 'cg-side');
  cg.append(mainCol, sideCol);

  const renderPreview = () => {
    const ctx = previewCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    // S1-2：纯色深底背景，取消渐变干扰
    ctx.fillStyle = '#12101e';
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    // 地面阴影
    ctx.fillStyle = 'rgba(10,8,20,.5)';
    ctx.beginPath();
    ctx.ellipse(previewCanvas.width / 2, previewCanvas.height - 14, 50, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    const pal = spritePalette('player', 'human', colors);
    pal.e = colors.eye; pal.U = colors.accent;
    pal.o = '#0a0814'; // S1-2：描边对比度强化
    const c = spriteToCanvas('player', 'human', pal, selClass, selRace, look);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 0, 0, previewCanvas.width, previewCanvas.height);
    // S1-2：面部放大窗口——截取头部 row 0-7
    const fctx = faceZoomCanvas.getContext('2d');
    fctx.imageSmoothingEnabled = false;
    fctx.clearRect(0, 0, faceZoomCanvas.width, faceZoomCanvas.height);
    fctx.fillStyle = '#1a1828';
    fctx.fillRect(0, 0, faceZoomCanvas.width, faceZoomCanvas.height);
    const headH = 8;
    const pal2 = spritePalette('player', 'human', colors);
    pal2.e = colors.eye; pal2.U = colors.accent; pal2.o = '#0a0814';
    const headSprite = spriteToCanvas('player', 'human', pal2, selClass, selRace, look);
    // S2-2：面部放大窗改等比——居中裁切 8×8 头部源区，整数 12 倍放大（原 16×8 拉成 96×96 导致纵向变形）
    fctx.drawImage(headSprite, 4, 0, 8, headH, 0, 0, faceZoomCanvas.width, faceZoomCanvas.height);
  };

  // S2-1：立绘随种族切换（展示层；无选中或资源缺失时回落占位提示）
  const renderPortrait = () => {
    const url = selRace ? portraitUrl(selRace) : null;
    if (url) {
      portraitEmpty.style.display = 'none';
      portraitImg.alt = (race() ? race().name : '') + '立绘';
      portraitImg.style.display = '';
      if (portraitImg.getAttribute('src') !== url) portraitImg.src = url;
    } else {
      portraitImg.removeAttribute('src');
      portraitImg.style.display = 'none';
      portraitEmpty.style.display = '';
    }
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
    look = { hair: 0, beard: 0, brow: 0, mouth: 0, marking: 0, ...(e.look || {}) };
    carryLevel = e.level || 1;
    carryXp = e.xp || 0;
    background = e.background || '';
    bgInput.value = background;
    sync();
    // F-20：载入即同步到房间——载入已保存角色等同于完成车卡，可直接准备开局（不再提示「请先完成车卡」）
    pushSheet(true);
    toast('📖 已载入角色「' + e.name + '」，可直接准备开战');
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
  // F-20：载入已保存角色与点击保存车卡都应视为可开始游戏——
  // 统一走pushSheet把车卡同步到房间（服务端才有room.sheets，准备/开局校验依赖它）
  const buildPayload = () => {
    const flexObj = {};
    for (const a of flexList) flexObj[a] = (flexObj[a] || 0) + 1;
    return { name, raceId: selRace, classId: selClass, stats: currentStats(), flex: flexObj, colors, background, look, level: carryLevel, xp: carryXp };
  };
  const pushSheet = (silent) => {
    const payload = buildPayload();
    loadedId = upsertEntry(payload, loadedId);
    refreshRosterSel();
    net.send('room:charsheet', { sheet: payload });
    if (!silent) toast('⏳ 正在保存车卡…');
  };
  saveBtn.onclick = () => {
    if (!name) { nameInput.focus(); toast('请先为角色起名', true); return; }
    if (!selRace || !selClass) { toast('请先选择种族与职业', true); return; }
    pushSheet(false);
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
    renderPortrait();
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

  let activeTab = 'color';
  function renderLook() {
    lookBox.innerHTML = '';
    // S1-1：Tab 分区 UI
    const tabBar = el('div', 'look-tabs');
    const TABS = [
      { id: 'color', label: '颜色' },
      { id: 'hair', label: '发型' },
      { id: 'face', label: '面部' },
      { id: 'preset', label: '预设' },
    ];
    for (const t of TABS) {
      const tb = el('button', 'look-tab' + (activeTab === t.id ? ' active' : ''), t.label);
      tb.onclick = () => { activeTab = t.id; renderLook(); };
      tabBar.appendChild(tb);
    }
    lookBox.appendChild(tabBar);
    const content = el('div', 'look-tab-content');
    if (activeTab === 'color') {
      const colorGroups = [
        { label: '肤色', key: 'skin', tones: SKIN_TONES },
        { label: '发色', key: 'hair', tones: HAIR_TONES },
        { label: '服色', key: 'outfit', tones: OUTFIT_TONES },
        { label: '瞳色', key: 'eye', tones: EYE_TONES },
        { label: '饰色', key: 'accent', tones: ACCENT_TONES },
      ];
      for (const g of colorGroups) {
        const row = el('div', 'color-row');
        row.appendChild(el('span', 'color-label', g.label));
        const swatchWrap = el('div', 'color-swatches');
        for (const c of g.tones) {
          const sw = el('div', 'color-swatch');
          sw.style.background = c;
          if (colors[g.key] === c) sw.classList.add('sel');
          sw.onclick = () => { colors[g.key] = c; renderLook(); renderPreview(); };
          swatchWrap.appendChild(sw);
        }
        row.appendChild(swatchWrap);
        content.appendChild(row);
      }
    } else if (activeTab === 'hair') {
      const HAIR_STYLES = ['默认', '长发', '发髻', '短发', '马尾', '双辫', '蓬松', '背头'];
      const hairSec = el('div', 'look-subsection');
      hairSec.appendChild(el('div', 'look-sublabel', '发型（8种）'));
      const hairGrid = el('div', 'style-grid');
      HAIR_STYLES.forEach((label, i) => {
        const b = el('button', 'style-btn' + (look.hair === i ? ' sel' : ''), label);
        b.onclick = () => { look.hair = i; renderLook(); renderPreview(); };
        hairGrid.appendChild(b);
      });
      hairSec.appendChild(hairGrid);
      content.appendChild(hairSec);
      const BEARD_STYLES = ['无', '短须', '长须', '络腮', '山羊胡'];
      const beardSec = el('div', 'look-subsection');
      beardSec.appendChild(el('div', 'look-sublabel', '胡须（5种）'));
      const beardGrid = el('div', 'style-grid');
      BEARD_STYLES.forEach((label, i) => {
        const b = el('button', 'style-btn' + (look.beard === i ? ' sel' : ''), label);
        b.onclick = () => { look.beard = i; renderLook(); renderPreview(); };
        beardGrid.appendChild(b);
      });
      beardSec.appendChild(beardGrid);
      content.appendChild(beardSec);
    } else if (activeTab === 'face') {
      const BROW_TYPES = ['标准', '粗眉', '细眉', '伤疤眉'];
      const browSec = el('div', 'look-subsection');
      browSec.appendChild(el('div', 'look-sublabel', '眉型'));
      const browGrid = el('div', 'style-grid');
      BROW_TYPES.forEach((label, i) => {
        const b = el('button', 'style-btn' + (look.brow === i ? ' sel' : ''), label);
        b.onclick = () => { look.brow = i; renderLook(); renderPreview(); };
        browGrid.appendChild(b);
      });
      browSec.appendChild(browGrid);
      content.appendChild(browSec);
      const MOUTH_TYPES = ['默认', '微笑', '严肃'];
      const mouthSec = el('div', 'look-subsection');
      mouthSec.appendChild(el('div', 'look-sublabel', '唇部'));
      const mouthGrid = el('div', 'style-grid');
      MOUTH_TYPES.forEach((label, i) => {
        const b = el('button', 'style-btn' + (look.mouth === i ? ' sel' : ''), label);
        b.onclick = () => { look.mouth = i; renderLook(); renderPreview(); };
        mouthGrid.appendChild(b);
      });
      mouthSec.appendChild(mouthGrid);
      content.appendChild(mouthSec);
      const MARKING_TYPES = ['无', '额纹', '颊纹', '下巴纹'];
      const markSec = el('div', 'look-subsection');
      markSec.appendChild(el('div', 'look-sublabel', '面部纹饰'));
      const markGrid = el('div', 'style-grid');
      MARKING_TYPES.forEach((label, i) => {
        const b = el('button', 'style-btn' + (look.marking === i ? ' sel' : ''), label);
        b.onclick = () => { look.marking = i; renderLook(); renderPreview(); };
        markGrid.appendChild(b);
      });
      markSec.appendChild(markGrid);
      content.appendChild(markSec);
    } else if (activeTab === 'preset') {
      const PRESETS = {
        human: [{ name: '骑士', skin: 1, hair: 0, outfit: 5, eye: 0, accent: 1, hairS: 3, beardS: 1 }, { name: '游侠', skin: 1, hair: 3, outfit: 8, eye: 1, accent: 5, hairS: 4, beardS: 0 }, { name: '法师', skin: 1, hair: 8, outfit: 10, eye: 3, accent: 6, hairS: 7, beardS: 0 }],
        elf: [{ name: '月精灵', skin: 0, hair: 8, outfit: 6, eye: 0, accent: 1, hairS: 1, beardS: 0 }, { name: '木精灵', skin: 2, hair: 2, outfit: 8, eye: 1, accent: 5, hairS: 5, beardS: 0 }],
        dwarf: [{ name: '山地矮人', skin: 3, hair: 5, outfit: 5, eye: 7, accent: 2, hairS: 0, beardS: 2 }],
        halfling: [{ name: '轻足', skin: 1, hair: 2, outfit: 5, eye: 7, accent: 2, hairS: 6, beardS: 0 }],
        halforc: [{ name: '战士', skin: 4, hair: 0, outfit: 5, eye: 6, accent: 7, hairS: 3, beardS: 3 }],
        dragonborn: [{ name: '龙骑士', skin: 3, hair: 9, outfit: 0, eye: 4, accent: 0, hairS: 7, beardS: 0 }],
        gnome: [{ name: '发明家', skin: 1, hair: 5, outfit: 2, eye: 1, accent: 2, hairS: 6, beardS: 1 }],
        halfelf: [{ name: '游吟诗人', skin: 1, hair: 3, outfit: 6, eye: 0, accent: 1, hairS: 1, beardS: 0 }],
      };
      const presets = PRESETS[selRace] || PRESETS.human;
      const presetSec = el('div', 'look-subsection');
      presetSec.appendChild(el('div', 'look-sublabel', '推荐外观'));
      const presetGrid = el('div', 'preset-grid');
      for (const p of presets) {
        const card = el('div', 'preset-card');
        card.appendChild(el('div', 'preset-name', p.name));
        card.onclick = () => {
          colors.skin = SKIN_TONES[p.skin]; colors.hair = HAIR_TONES[p.hair]; colors.outfit = OUTFIT_TONES[p.outfit];
          colors.eye = EYE_TONES[p.eye]; colors.accent = ACCENT_TONES[p.accent];
          look.hair = p.hairS; look.beard = p.beardS; look.brow = 0; look.mouth = 0; look.marking = 0;
          renderLook(); renderPreview();
        };
        presetGrid.appendChild(card);
      }
      presetSec.appendChild(presetGrid);
      content.appendChild(presetSec);
    }
    lookBox.appendChild(content);
    // 底部操作按钮
    const btnRow = el('div', 'look-actions');
    const rndBtn = el('button', 'btn small gold', '随机外观');
    rndBtn.onclick = () => {
      colors.skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
      colors.hair = HAIR_TONES[Math.floor(Math.random() * HAIR_TONES.length)];
      colors.outfit = OUTFIT_TONES[Math.floor(Math.random() * OUTFIT_TONES.length)];
      colors.eye = EYE_TONES[Math.floor(Math.random() * EYE_TONES.length)];
      colors.accent = ACCENT_TONES[Math.floor(Math.random() * ACCENT_TONES.length)];
      look.hair = Math.floor(Math.random() * 8);
      look.beard = Math.floor(Math.random() * 5);
      look.brow = Math.floor(Math.random() * 4);
      look.mouth = Math.floor(Math.random() * 3);
      look.marking = Math.floor(Math.random() * 4);
      renderLook(); renderPreview();
    };
    const resetBtn = el('button', 'btn small', '重置');
    resetBtn.onclick = () => {
      look.hair = 0; look.beard = 0; look.brow = 0; look.mouth = 0; look.marking = 0;
      colors.skin = SKIN_TONES[0]; colors.hair = HAIR_TONES[0]; colors.outfit = OUTFIT_TONES[0];
      colors.eye = EYE_TONES[0]; colors.accent = ACCENT_TONES[0];
      renderLook(); renderPreview();
    };
    btnRow.append(rndBtn, resetBtn);
    lookBox.appendChild(btnRow);
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
