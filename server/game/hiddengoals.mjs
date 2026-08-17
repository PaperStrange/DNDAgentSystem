// 隐藏目标系统：开局由AI DM根据剧本与车卡为每人下发1个私密目标；全部达成即隐藏胜利
// 离线模式使用18种机械可验证模板；在线模式由LLM生成自由目标并裁定宣称

export const GOAL_TEMPLATES = [
  { id: 'warlust', name: '战意如潮', bias: ['fighter', 'ranger', 'rogue'], 
    text: (p) => '在本次冒险中累计造成至少100点伤害',
    verify: (s) => s.damageDealt >= 100 },
  { id: 'hunter', name: '猎手之刃', bias: ['ranger', 'fighter', 'rogue'],
    text: (p) => '亲手击杀至少4名敌人',
    verify: (s) => s.kills >= 4 },
  { id: 'pacifist', name: '和平之道', bias: ['cleric'],
    text: (p) => '全程不亲手造成任何伤害，并活着见证冒险的结局',
    verify: (s, alive) => s.damageDealt === 0 && alive },
  { id: 'rich', name: '聚宝之魂', bias: ['rogue', 'ranger'],
    text: (p) => '在冒险中累计获得至少120枚金币',
    verify: (s) => s.goldEarned >= 120 },
  { id: 'healer', name: '仁心圣手', bias: ['cleric'],
    text: (p) => '累计治疗队友（含自己）至少40点生命',
    verify: (s) => s.healed >= 40 },
  { id: 'arcanist', name: '奥术狂热', bias: ['wizard'],
    text: (p) => '累计施放法术至少5次',
    verify: (s) => s.spellsCast >= 5 },
  { id: 'diplomat', name: '舌灿莲花', bias: ['rogue', 'cleric', 'wizard'],
    text: (p) => '在对话中分别使用过「说服」「欺瞒」「威吓」三种交涉方式',
    verify: (s) => ['persuasion', 'deception', 'intimidation'].every(t => s.talkTags.includes(t)) },
  { id: 'lucky', name: '天命眷顾', bias: [],
    text: (p) => '在战斗中至少打出2次重击',
    verify: (s) => s.crits >= 2 },
  { id: 'survivor', name: '死里逃生', bias: ['fighter'],
    text: (p) => '至少倒下1次，却活着站到最后',
    verify: (s, alive) => s.downed >= 1 && alive },
  { id: 'explorer', name: '寻宝猎人', bias: ['rogue', 'ranger'],
    text: (p) => '累计搜索或开启宝箱至少6次',
    verify: (s) => s.searches + s.chestsOpened >= 6 },
  { id: 'dragonslayer', name: '屠蛛勇士', bias: ['fighter', 'ranger'],
    text: (p) => '亲手给黑蜘蛛涅兹纳尔致命一击',
    verify: (s) => s.bossLastHit === true },
  { id: 'shadow', name: '暗影行者', bias: ['rogue'],
    text: (p) => '使用躲藏动作至少3次',
    verify: (s) => s.usesHide >= 3 },
  { id: 'bastion', name: '铜墙铁壁', bias: ['fighter'],
    text: (p) => '承受至少100点伤害，且活到终局',
    verify: (s, alive) => s.damageTaken >= 100 && alive },
  { id: 'pyromancer', name: '焚天烈焰', bias: ['wizard'],
    text: (p) => '一次攻击或法术同时命中至少3名敌人',
    verify: (s) => s.maxMultiHit >= 3 },
  { id: 'rescuer', name: '救赎之手', bias: ['cleric'],
    text: (p) => '参与救出西达尔与冈德伦（两位NPC均获救）',
    verify: (s) => s.rescues.includes('sildar') && s.rescues.includes('gundren') },
  { id: 'flawless', name: '完美无瑕', bias: ['wizard', 'rogue'],
    text: (p) => '全程从未倒下，承受伤害低于60，活到终局',
    verify: (s, alive) => s.downed === 0 && s.damageTaken < 60 && alive },
  { id: 'vanguard', name: '先登勇士', bias: ['fighter', 'ranger'],
    text: (p) => '以至少15点的先攻值赢下2场战斗',
    verify: (s) => s.initiativeWins >= 2 },
  { id: 'ascetic', name: '苦修者', bias: [],
    text: (p) => '全程不使用任何休息，并活到终局',
    verify: (s, alive) => s.restsUsed === 0 && alive },
];

const BIAS_CACHE = {};
function biasPool(classId) {
  if (BIAS_CACHE[classId]) return BIAS_CACHE[classId];
  const biased = GOAL_TEMPLATES.filter(g => g.bias.includes(classId));
  const others = GOAL_TEMPLATES.filter(g => !g.bias.length);
  BIAS_CACHE[classId] = { biased, others };
  return BIAS_CACHE[classId];
}

import { pick, shuffle } from '../util.mjs';

// 离线分配：职业偏好为主，随机挑选，避免重复
export function assignOfflineGoals(players) {
  const used = new Set();
  const out = new Map();
  const pids = shuffle([...players.keys()]);
  for (const pid of pids) {
    const p = players.get(pid);
    const { biased, others } = biasPool(p.sheet.class);
    const cands = shuffle([...biased.map(g => g.id), ...others.map(g => g.id)]).filter(id => !used.has(id));
    const poolIds = cands.length ? cands : GOAL_TEMPLATES.map(g => g.id).filter(id => !used.has(id));
    const id = poolIds[0] ?? pick(GOAL_TEMPLATES).id;
    used.add(id);
    const tpl = GOAL_TEMPLATES.find(g => g.id === id);
    out.set(pid, { id: tpl.id, name: tpl.name, text: tpl.text(p), status: 'pending', offline: true });
  }
  return out;
}

// 离线验证宣称
export function offlineVerify(goal, stats, alive) {
  const tpl = GOAL_TEMPLATES.find(g => g.id === goal.id);
  if (!tpl) return false;
  return tpl.verify(stats, alive);
}

// 生成给LLM的目标生成prompt摘要
export function goalPromptContext(players) {
  return [...players.entries()].map(([pid, p]) => {
    const s = p.sheet;
    return '玩家[' + p.name + ']：' + s.raceName + ' ' + s.className + '，主属性' + s.mainAttr + '，背景「' + s.background + '」。';
  }).join('\n');
}
