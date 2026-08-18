// 房间管理：大厅/准备/游戏中/结算 状态机 + 消息分发
import { roomCode, uid } from '../util.mjs';
import { Game } from './game.mjs';
import { Director } from '../dm/director.mjs';
import { DUNGEONS, MONSTERS } from './dungeon.mjs';
import { PERSONAS, personaSummary, personaById } from '../dm/personas.mjs';
import { buildSheet } from './charsheet.mjs';
import { chat, llmAvailable } from '../llm.mjs';

export const MAX_PLAYERS = 5;

// R-12：离线背景故事模板（每条≥150字、风格各异，供随机生成）
export const BG_TEMPLATES = [
  (race, cls) => '凡达林的酒馆里流传着这样一则轶闻：一位' + race + '出身的' + cls + '，曾在某个雨夜独自击退了三名闹事的醉汉，只因他们踢翻了他的酒杯。有人说他流浪至此是为了躲避旧日的债，有人说他在寻找一件失传的宝物。无论真假，每当炉火噼啪作响，人们总会压低声音，把这件事讲给新来的旅人听，仿佛他早已是这座小镇命运的一部分。如今，故事仍在继续。',
  (race, cls) => '占卜师在烛光下翻开了泛黄的纸牌，指着其中一张说道："你将踏上一条布满箭矢与阴影的路，最终站在黑蜘蛛的王座之前。"这位' + race + '起初只当是疯话，直到连日梦见同一座洞穴与同一双眼睛。于是他收拾行囊、告别故土，把占卜的残片缝进行囊的衬里，循着命运的丝线一路向西，走向那座名为凡达林的镇子。据说，那副泛黄的牌从未出过错。',
  (race, cls) => '他曾经是商队护卫队的一员，在那场哥布林伏击中失去了所有的同伴，只有身为' + race + '的' + cls + '活了下来。从那以后，他不再相信任何没有刀鞘的承诺，并在残破的马车旁立下誓言：再也不会让任何同行者倒在自己前面。如今他背着修补过无数次的行囊，重新走上通往凡达林的道路，只为完成一桩早已无人记得的委托，和一场迟来的告别。此志不移。',
  (race, cls) => '拨动三弦，且听我唱一段' + race + '的故事：这位' + cls + '生来不合群，白日里磨剑擦弓，黑夜里对着篝火和自己的影子说话。镇上的孩子笑他是疯子，直到野狼夜袭羊圈的那一晚，他独自提着火把走进黑暗，天亮时拖回三张狼皮。从此再无人敢嘲笑他。如今他哼着自编的小调出了镇子，说要到凡达林去，看看那里是不是真有比狼更坏的东西。歌还没唱完。',
  (race, cls) => '朝圣途中，我在十字路口遇见一位' + race + '。他自称' + cls + '，却对神殿的规矩一知半解，只反复擦拭一枚磨得发亮的护符。他说自己并非朝圣，而是要去凡达林寻找一个失踪多年的旧友。临别时他告诉我，若是听到北边洞穴里传来狼嚎，就替他点一盏灯。我不明白那是什么意思，但多年以后想起那双眼睛，总觉得有些故事，从一开始就注定与黑夜为伴。',
  (race, cls) => '这是一封从未寄出的信："母亲，我如今成了一名' + cls + '。别担心，' + race + '的血液让我比看上去更结实。我在路上听说凡达林的矿洞出了事，冈德伦兄弟的马车在岔路口被掀翻。也许我只是个外乡人，可总得有人去看看。等春天，等我把洞里的黑蜘蛛揪出来，就回家看您。"信纸的边角已经发黄，落款处没有名字，只有一枚沾着尘土的指印。而旅程才刚刚开始。',
];

export class Rooms {
  constructor() {
    this.rooms = new Map(); // code -> room
  }
  roomList() {
    return [...this.rooms.values()].map(r => ({
      code: r.code, hostName: r.hostName, dungeonId: r.dungeonId, dungeonName: r.dungeonName,
      persona: r.personaId, personaName: r.personaName, phase: r.phase, members: r.members.length, max: MAX_PLAYERS,
    }));
  }
  createRoom(host, { dungeonId, personaId, mode }) {
    const dungeon = DUNGEONS.find(d => d.id === dungeonId);
    const persona = personaById(personaId);
    if (!dungeon || !persona) return { err: '副本或DM人设无效' };
    let code = roomCode();
    while (this.rooms.has(code)) code = roomCode();
    const room = {
      code, hostId: host.pid, hostName: host.name, dungeonId, dungeonName: dungeon.name,
      personaId: persona.id, personaName: persona.name, phase: 'prepare',
      mode: mode === 'manual' ? 'manual' : 'auto', // 战斗模式：默认自动战斗
      members: [host.pid], sheets: new Map(), ready: new Set(),
      game: null, director: null, createdAt: Date.now(),
      lastTouched: Date.now(),
    };
    this.rooms.set(code, room);
    return { room };
  }
  joinRoom(code, player) {
    const room = this.rooms.get(code);
    if (!room) return { err: '房间不存在' };
    if (room.phase !== 'prepare') return { err: '游戏已开始，无法加入（掉线可重连）' };
    if (room.members.length >= MAX_PLAYERS) return { err: '房间已满（最多5名玩家）' };
    if (!room.members.includes(player.pid)) room.members.push(player.pid);
    room.ready.delete(player.pid);
    room.lastTouched = Date.now();
    return { room };
  }
  leaveRoom(player) {
    const room = this.roomOf(player);
    if (!room) { player.roomCode = null; return { left: true }; }
    const wasHost = room.hostId === player.pid;
    room.members = room.members.filter(p => p !== player.pid);
    room.ready.delete(player.pid);
    if (room.game && (room.phase === 'playing' || room.phase === 'intro' || room.phase === 'ended')) room.game.removePlayer(player.pid, false);
    player.roomCode = null;
    if (room.members.length === 0) { this._close(room); return { left: true }; }
    if (wasHost) {
      room.hostId = room.members[0];
      const p = this._playerName(room.hostId);
      room.hostName = p;
    }
    if (room.phase === 'prepare') this._checkAutoStart(room);
    return { left: true, room };
  }
  kickRoom(host, targetPid) {
    const room = this.roomOf(host);
    if (!room || room.hostId !== host.pid) return { err: '只有房主可以踢人' };
    if (!room.members.includes(targetPid)) return { err: '目标不在房间中' };
    if (targetPid === host.pid) return { err: '不能踢自己' };
    room.members = room.members.filter(p => p !== targetPid);
    room.ready.delete(targetPid);
    if (room.game && room.phase === 'playing') room.game.removePlayer(targetPid, true);
    if (room.members.length === 0) { this._close(room); return { kicked: true, victimPid: targetPid }; }
    if (room.phase === 'prepare') this._checkAutoStart(room);
    return { kicked: true, room, victimPid: targetPid };
  }
  setSheet(player, rawSheet) {
    const room = this.roomOf(player);
    if (!room || room.phase !== 'prepare') return { err: '现在不能修改车卡' };
    const sheet = buildSheet(rawSheet);
    room.sheets.set(player.pid, sheet);
    room.ready.delete(player.pid);
    room.lastTouched = Date.now();
    return { room };
  }
  setReady(player, ready) {
    const room = this.roomOf(player);
    if (!room || room.phase !== 'prepare') return { err: '现在不能准备' };
    if (ready && !room.sheets.has(player.pid)) return { err: '请先完成车卡' };
    if (ready) room.ready.add(player.pid); else room.ready.delete(player.pid);
    if (ready) this._checkAutoStart(room);
    return { room };
  }
  _checkAutoStart(room) {
    if (room.phase !== 'prepare') return;
    // B-10：单人不再自动开局——需玩家确认后显式发送 room:start（或等队友加入全员就绪）
    if (room.members.length >= 2 && room.members.every(p => room.ready.has(p))) {
      this.startGame(room);
    }
  }
  async startGame(room) {
    if (room.phase !== 'prepare') return;
    room.phase = 'intro';
    room.director = new Director({ personaId: room.personaId, dungeon: DUNGEONS.find(d => d.id === room.dungeonId) });
    const sheets = new Map([...room.members].map(pid => [pid, room.sheets.get(pid)]));
    room.game = new Game({ room: { code: room.code, dungeonId: room.dungeonId, hostId: room.hostId, mode: room.mode }, sheets, personaId: room.personaId, director: room.director, onChange: () => this._broadcastRoom(room), isPlayerOnline: (pid) => this._isOnline ? this._isOnline(pid) : true });
    const g = room.game;
    const origEnd = g._endGame.bind(g);
    g._endGame = (kind, reason) => { origEnd(kind, reason); room.phase = 'ended'; this.touch(room); };
    // 开场：旁白+隐藏目标（LLM可能耗时，就绪后进入playing）
    room.director.intro(room.game).then(() => {
      room.phase = 'playing';
      this.touch(room);
      this._broadcastRoom(room);
    }).catch(e => {
      console.error('[room] 开场失败', e);
      room.game.beginPlay();
      room.phase = 'playing';
      this.touch(room);
      this._broadcastRoom(room);
    });
  }
  returnToRoom(player) {
    const room = this.roomOf(player);
    if (!room || room.phase !== 'ended') return { err: '现在不能返回' };
    room.phase = 'prepare';
    room.game = null; room.director = null;
    room.ready.clear();
    this.touch(room);
    return { room };
  }
  roomOf(player) {
    return this.rooms.get(player.roomCode) || null;
  }
  _playerName(pid) { return this._registryName?.(pid) || '房主'; }
  _close(room) {
    if (room.game) { room.game.closed = true; for (const t of room.game.timers) clearTimeout(t); }
    this.rooms.delete(room.code);
  }
  touch(room) { room.lastTouched = Date.now(); }
  // 周期清理空房间/僵尸房间
  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.members.length === 0 || now - room.lastTouched > 6 * 3600e3) this._close(room);
    }
  }

  // ---------- 消息分发（由index.mjs调用） ----------
  async dispatch(player, msg) {
    const t = msg.t;
    if (t.startsWith('lobby:')) return this._lobby(player, msg);
    if (t.startsWith('room:')) return this._roomMsg(player, msg);
    if (t.startsWith('game:')) return this._gameMsg(player, msg);
    return { err: '未知消息' };
  }
  _lobby(player, msg) {
    if (msg.t === 'lobby:create') return this.createRoom(player, { dungeonId: msg.dungeonId, personaId: msg.personaId, mode: msg.mode });
    if (msg.t === 'lobby:join') {
      const r = this.joinRoom(msg.code, player);
      return r;
    }
    return { err: '未知消息' };
  }
  _roomMsg(player, msg) {
    if (msg.t === 'room:leave') return this.leaveRoom(player);
    if (msg.t === 'room:kick') return this.kickRoom(player, msg.targetPid);
    if (msg.t === 'room:charsheet') return this.setSheet(player, msg.sheet);
    if (msg.t === 'room:ready') return this.setReady(player, !!msg.ready);
    // R-14：车卡阶段房主可随时切换自动/手动战斗模式
    if (msg.t === 'room:mode') {
      const room = this.roomOf(player);
      if (!room || room.phase !== 'prepare') return { err: '现在不能修改战斗模式' };
      if (room.hostId !== player.pid) return { err: '只有房主可以修改战斗模式' };
      room.mode = msg.mode === 'manual' ? 'manual' : 'auto';
      return { room };
    }
    if (msg.t === 'room:start') {
      const room = this.roomOf(player);
      if (!room) return { err: '不在房间中' };
      if (room.phase !== 'prepare') return { err: '无法开始' };
      if (room.members.some(p => !room.ready.has(p))) return { err: '还有玩家未准备' };
      this.startGame(room);
      return { room };
    }
    if (msg.t === 'room:return') return this.returnToRoom(player);
    if (msg.t === 'room:bg-random') return this.randomBackground(player, msg);
    return { err: '未知消息' };
  }
  // R-2/R-12: 由LLM为角色随机生成背景故事（≥150字、随机独特风格；离线模板降级）
  async randomBackground(player, msg) {
    const { RACES, CLASSES } = await import('../../public/shared/char-defs.mjs');
    const race = RACES.find(r => r.id === msg.raceId);
    const cls = CLASSES.find(c => c.id === msg.classId);
    if (!race || !cls) return { err: '参数无效' };
    const styles = ['酒馆轶闻', '宿命预言', '老兵回忆', '街头艺人唱词', '朝圣者见闻', '旧日信笺'];
    const style = styles[Math.floor(Math.random() * styles.length)];
    if (llmAvailable()) {
      try {
        const res = await chat([
          { role: 'system', content: '你是龙与地下城的DM，擅长为冒险者撰写背景故事。请以「' + style + '」的口吻写一段背景故事：150~220字，简体中文，不分段，风格独特、有画面感；不出现角色名字，用第三人称或「你」叙述均可。' },
          { role: 'user', content: '种族：' + race.name + '；职业：' + cls.name + '。请直接输出故事正文。' },
        ], { temperature: 1.1, timeoutMs: 25000 });
        const text = res?.text?.trim();
        if (text && text.replace(/\s/g, '').length >= 145) return { ok: true, text: text.slice(0, 400) }; // 不足145字则降级到≥150字模板
      } catch (e) { /* 降级 */ }
    }
    const tpl = BG_TEMPLATES;
    return { ok: true, text: tpl[Math.floor(Math.random() * tpl.length)](race.name, cls.name) };
  }
  async _gameMsg(player, msg) {
    const room = this.roomOf(player);
    if (!room || !room.game) return { err: '没有进行中的游戏' };
    const g = room.game;
    const t = msg.t;
    if (t === 'game:move') return g.actMove(player.pid, { x: msg.x, y: msg.y });
    if (t === 'game:attack') return g.actAttack(player.pid, { targetEid: msg.targetEid });
    if (t === 'game:cast') return g.actCast(player.pid, { spellId: msg.spellId, targetEid: msg.targetEid, x: msg.x, y: msg.y });
    if (t === 'game:item') return g.actUseItem(player.pid, { itemId: msg.itemId, targetEid: msg.targetEid });
    if (t === 'game:dash') return g.actDash(player.pid);
    if (t === 'game:hide') return g.actHide(player.pid);
    if (t === 'game:search') return g.actSearch(player.pid);
    if (t === 'game:rest') return g.actShortRest(player.pid);
    if (t === 'game:interact') return g.actInteract(player.pid, { targetEid: msg.targetEid, tx: msg.tx, ty: msg.ty });
    if (t === 'game:dialogue') return g.actDialogueOption(player.pid, { optionId: msg.optionId });
    if (t === 'game:claim') return g.actClaim(player.pid);
    if (t === 'game:say') return g.actSay(player.pid, msg.text);
    if (t === 'game:endturn') return g.actEndTurn(player.pid);
    // R-15：速度/暂停仅房主可操作（服务器端强制）
    if (t === 'game:speed') { if (room.hostId !== player.pid) return { err: '只有房主可以调整战斗速度' }; g.speed = Math.min(4, Math.max(0.5, Number(msg.speed) || 1)); return { ok: true }; }
    if (t === 'game:pause') { if (room.hostId !== player.pid) return { err: '只有房主可以暂停' }; g.paused = !!msg.paused; return { ok: true }; }
    if (t === 'game:eval') return g.evaluate(player.pid);
    if (t === 'game:leave') return this.leaveRoom(player);
    return { err: '未知消息' };
  }

  // ---------- 快照 ----------
  snapshotFor(player) {
    // 大厅视图
    if (!player.roomCode) return { view: 'lobby', rooms: this.roomList(), dungeons: DUNGEONS.map(d => ({ id: d.id, name: d.name, icon: d.icon, desc: d.desc, publicGoal: d.publicGoal.text })), personas: PERSONAS.map(personaSummary), me: { pid: player.pid, name: player.name } };
    const room = this.rooms.get(player.roomCode);
    if (!room) { player.roomCode = null; return this.snapshotFor(player); }
    const members = room.members.map(pid => ({
      pid, name: this._registryName?.(pid) || pid,
      sheet: room.sheets.get(pid) || null,
      ready: room.ready.has(pid), isHost: room.hostId === pid, online: this._isOnline?.(pid) ?? true,
      isMe: pid === player.pid,
    }));
    if (room.phase === 'prepare') {
      return {
        view: 'room', phase: 'prepare',
        room: { code: room.code, hostId: room.hostId, dungeonId: room.dungeonId, dungeonName: room.dungeonName, personaId: room.personaId, personaName: room.personaName, mode: room.mode, max: MAX_PLAYERS },
        dungeon: DUNGEONS.find(d => d.id === room.dungeonId),
        persona: personaSummary(personaById(room.personaId)),
        members, me: { pid: player.pid, name: player.name },
        mySheet: room.sheets.get(player.pid) || null,
      };
    }
    if (room.phase === 'ended') {
      const view = room.game ? room.game.snapshotFor(player.pid) : null;
      return { view: 'game', phase: 'ended', room: { code: room.code, hostId: room.hostId, personaName: room.personaName }, members, game: view, win: room.game?.win || null };
    }
    // intro / playing
    const view = room.game ? room.game.snapshotFor(player.pid) : null;
    return {
      view: 'game', phase: room.phase === 'intro' ? 'intro' : (view?.state === 'ended' ? 'ended' : 'playing'),
      room: { code: room.code, hostId: room.hostId, personaName: room.personaName, dungeonName: room.dungeonName },
      members,
      game: view,
    };
  }
  // 由index.mjs注入注册表引用与广播函数
  bindRegistry(getName, isOnline, broadcast) { this._registryName = getName; this._isOnline = isOnline; this._broadcast = broadcast; }
  _broadcastRoom(room) { if (this._broadcast) this._broadcast(room); }

  isMember(pid, room) { return room.members.includes(pid); }
}
