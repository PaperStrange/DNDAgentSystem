// 房间管理：大厅/准备/游戏中/结算 状态机 + 消息分发
import { roomCode, uid } from '../util.mjs';
import { Game } from './game.mjs';
import { Director } from '../dm/director.mjs';
import { DUNGEONS, MONSTERS } from './dungeon.mjs';
import { PERSONAS, personaSummary, personaById } from '../dm/personas.mjs';
import { buildSheet } from './charsheet.mjs';
import { chat, llmAvailable } from '../llm.mjs';

export const MAX_PLAYERS = 5;

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
    if (room.members.length >= 1 && room.members.every(p => room.ready.has(p))) {
      this.startGame(room);
    }
  }
  async startGame(room) {
    if (room.phase !== 'prepare') return;
    room.phase = 'intro';
    room.director = new Director({ personaId: room.personaId, dungeon: DUNGEONS.find(d => d.id === room.dungeonId) });
    const sheets = new Map([...room.members].map(pid => [pid, room.sheets.get(pid)]));
    room.game = new Game({ room: { code: room.code, dungeonId: room.dungeonId }, sheets, personaId: room.personaId, director: room.director, onChange: () => this._broadcastRoom(room), isPlayerOnline: (pid) => this._isOnline ? this._isOnline(pid) : true });
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
  // R-2: 由LLM为角色随机生成一句背景（离线模板降级）
  async randomBackground(player, msg) {
    const { RACES, CLASSES } = await import('../../public/shared/char-defs.mjs');
    const race = RACES.find(r => r.id === msg.raceId);
    const cls = CLASSES.find(c => c.id === msg.classId);
    if (!race || !cls) return { err: '参数无效' };
    if (llmAvailable()) {
      try {
        const res = await chat([
          { role: 'system', content: '你是龙与地下城的DM。请为玩家角色即兴创作一句背景故事（25字以内，简体中文，一句话，不含名字）。' },
          { role: 'user', content: '种族：' + race.name + '；职业：' + cls.name + '。请写一句富有画面感的背景。' },
        ], { temperature: 1.0, timeoutMs: 12000 });
        if (res && res.text) return { ok: true, text: res.text.slice(0, 50) };
      } catch (e) { /* 降级 */ }
    }
    const tpl = [
      '曾是' + race.name + '中的一员，如今带着' + cls.name + '的本领行走四方。',
      '在' + race.name + '的聚落长大，一心想要成为传奇' + cls.name + '。',
      '背井离乡的' + race.name + '，靠' + cls.name + '的手艺讨生活。',
    ];
    return { ok: true, text: tpl[Math.floor(Math.random() * tpl.length)] };
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
    if (t === 'game:speed') { g.speed = Math.min(4, Math.max(0.5, Number(msg.speed) || 1)); return { ok: true }; }
    if (t === 'game:pause') { g.paused = !!msg.paused; return { ok: true }; }
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
