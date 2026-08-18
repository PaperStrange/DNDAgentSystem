// R-17 冒烟：DM裁定必须写入'ruling'日志、注明规则依据、仅房主可见
process.env.DND_OFFLINE = '1';
const { setSeed } = await import('../server/util.mjs');
const { Game } = await import('../server/game/game.mjs');
const { Director } = await import('../server/dm/director.mjs');
const { buildSheet } = await import('../server/game/charsheet.mjs');
const { assignOfflineGoals } = await import('../server/game/hiddengoals.mjs');
setSeed(42);

let failed = false;
const ok = (m) => console.log('✅ ' + m);
const fail = (m) => { failed = true; console.log('❌ ' + m); };

const sheets = new Map([
  ['HOST', buildSheet({ name: '房主', raceId: 'human', classId: 'fighter', stats: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 10, CHA: 8 }, flex: { CON: 1 } })],
  ['GUEST', buildSheet({ name: '访客', raceId: 'human', classId: 'cleric', stats: { STR: 12, DEX: 10, CON: 14, INT: 10, WIS: 15, CHA: 10 }, flex: { CON: 1 } })],
]);
const director = new Director({ personaId: 'aldric', dungeon: { id: 'lmop', name: '测试', chapters: [{ npcs: [{ def: 'sildar' }], monsters: [{ def: 'klarg', squad: 'boss' }] }] } });
const game = new Game({ room: { code: 'T', dungeonId: 'lmop', hostId: 'HOST', mode: 'auto' }, sheets, personaId: 'aldric', director });
const goals = assignOfflineGoals(game.players);
for (const [pid, g] of goals) game.players.get(pid).goals = [g];

const guest = game.players.get('GUEST');
const goal = guest.goals[0];
const alive = true;

// 先造一个未达成的宣称（stats全0，绝大多数目标都不满足）
guest.stats.damageDealt = 0; guest.stats.kills = 0; guest.stats.goldEarned = 0;
guest.stats.healed = 0; guest.stats.spellsCast = 0; guest.stats.crits = 0; guest.stats.downed = 0;
guest.stats.searches = 0; guest.stats.chestsOpened = 0; guest.stats.usesHide = 0;
const res = await director.judgeClaim(game, guest, goal, alive);
console.log('裁定结果 ok=' + res.ok + ' 目标=' + goal.name + ' ' + goal.text);
const rulings = game.log.filter(l => l.kind === 'ruling');
if (rulings.length === 1) ok('R-17 裁定写入ruling日志（' + rulings[0].text.slice(0, 60) + '…）');
else fail('R-17 ruling日志缺失 数量=' + rulings.length);
if (rulings[0]?.private === 'HOST') ok('R-17 裁定日志仅房主可见（private=HOST）');
else fail('R-17 私密标记异常 ' + JSON.stringify(rulings[0]));
if (String(rulings[0]?.text).includes('规则依据')) ok('R-17 裁定注明规则依据');
else fail('R-17 未注明规则依据');
const hostSnap = game.snapshotFor('HOST');
const guestSnap = game.snapshotFor('GUEST');
if (hostSnap.log.some(l => l.kind === 'ruling')) ok('R-17 房主快照可见裁定依据');
else fail('R-17 房主快照看不到裁定');
if (!guestSnap.log.some(l => l.kind === 'ruling')) ok('R-17 访客快照不含裁定依据（权限隔离）');
else fail('R-17 访客越权看到裁定');
console.log(failed ? 'RULING RESULT: FAIL' : 'RULING RESULT: PASS');
process.exit(failed ? 1 : 0);
