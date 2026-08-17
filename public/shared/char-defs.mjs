// 共享车卡数据：服务端(charsheet.mjs)与客户端(车卡界面)共用
export const RACES = [
  { id: 'human', name: '人类', icon: '🧑', desc: '适应力最强、最百搭的种族，任何职业都能胜任。', stats: {}, flex: 2,
    features: [{ name: '多才多艺', desc: '额外熟练1项技能；任意两项属性+1（在车卡中分配）' }], speed: 6 },
  { id: 'elf', name: '精灵', icon: '🧝', desc: '长寿优雅的林间种族，天生敏捷，感知敏锐。', stats: { DEX: 2, WIS: 1 }, flex: 0,
    features: [{ name: '敏锐感知', desc: '熟练：察觉；移动速度+1格' }, { name: '精灵之眠', desc: '免疫睡眠' }], speed: 7, skills: ['perception'] },
  { id: 'dwarf', name: '矮人', icon: '🧔', desc: '山岳的子女，坚韧顽强，天生抗毒。', stats: { CON: 2, STR: 1 }, flex: 0,
    features: [{ name: '矮人体魄', desc: '每级生命上限+1；对毒素伤害有抗性' }, { name: '石匠直觉', desc: '熟练：历史(石造物相关检定优势)' }], speed: 5, skills: ['history'] },
  { id: 'halfling', name: '半身人', icon: '🥔', desc: '小巧乐观的幸运儿，总能逢凶化吉。', stats: { DEX: 2, CHA: 1 }, flex: 0,
    features: [{ name: '幸运儿', desc: '攻击掷出自然1时，每轮可重掷一次' }, { name: '小巧身形', desc: '躲藏检定优势' }], speed: 6, skills: ['stealth'] },
  { id: 'halforc', name: '半兽人', icon: '👹', desc: '野性之血，濒死时反而爆发出惊人韧性。', stats: { STR: 2, CON: 1 }, flex: 0,
    features: [{ name: '顽强不屈', desc: '倒地后第一次死亡豁免自动成功' }, { name: '威猛姿态', desc: '熟练：威吓' }], speed: 6, skills: ['intimidation'] },
  { id: 'dragonborn', name: '龙裔', icon: '🐲', desc: '巨龙后裔，喷吐着祖辈的元素之息。', stats: { STR: 2, CHA: 1 }, flex: 0,
    features: [{ name: '龙息', desc: '每章1次：喷吐2d6元素伤害，前方锥形范围，敏捷豁免减半' }], speed: 6 },
  { id: 'gnome', name: '侏儒', icon: '🎩', desc: '聪明的小个子，对魔法有天然的抵抗力。', stats: { INT: 2, CON: 1 }, flex: 0,
    features: [{ name: '侏儒狡黠', desc: '对法术的豁免检定优势，敌人对你的法术攻击有劣势' }], speed: 6, skills: ['arcana'] },
  { id: 'halfelf', name: '半精灵', icon: '🌙', desc: '人精灵血统交融，魅力与才艺兼备。', stats: { CHA: 2 }, flex: 2,
    features: [{ name: '双族传承', desc: '熟练2项自选技能；免疫睡眠' }], speed: 6 },
];

export const CLASSES = [
  { id: 'fighter', name: '战士', icon: '⚔️', hitDie: 10, hpPerLv: 6, main: 'STR', ac: 16, armor: '链甲(不享敏捷)',
    skills: ['athletics', 'intimidation'], weapons: [{ id: 'longsword', name: '长剑', dice: '1d8', mod: 'STR', range: 1 }, { id: 'longbow', name: '长弓', dice: '1d8', mod: 'DEX', range: 15 }],
    desc: '战场的中流砥柱，最耐打、最稳定的近战输出。',
    features: [
      { lv: 1, name: '战斗风格·攻守', desc: '攻击+1' },
      { lv: 2, name: '二打', desc: '攻击动作可进行两次攻击' },
      { lv: 3, name: '战术大师', desc: '每场战斗1次：一次攻击获得优势' },
    ] },
  { id: 'wizard', name: '法师', icon: '🔮', hitDie: 6, hpPerLv: 4, main: 'INT', ac: 12, armor: '无甲(敏捷加成)',
    skills: ['arcana', 'investigation'], weapons: [{ id: 'dagger', name: '匕首', dice: '1d4', mod: 'DEX', range: 1 }],
    spells: ['firebolt', 'magicmissile', 'burninghands'],
    desc: '掌握奥术之力的脆皮炮台，远程火力与控场担当。',
    features: [
      { lv: 1, name: '奥术研习', desc: '2个1环法术位；戏法无限' },
      { lv: 2, name: '奥术学徒', desc: '1环法术位+1' },
      { lv: 3, name: '法术增幅', desc: '伤害法术额外+1d4伤害' },
    ] },
  { id: 'rogue', name: '游荡者', icon: '🗡️', hitDie: 8, hpPerLv: 5, main: 'DEX', ac: 14, armor: '皮甲(敏捷+2)',
    skills: ['stealth', 'sleight'], weapons: [{ id: 'shortsword', name: '短剑', dice: '1d6', mod: 'DEX', range: 1 }, { id: 'shortbow', name: '短弓', dice: '1d6', mod: 'DEX', range: 10 }],
    desc: '阴影中的致命刺客，开锁摸金、偷袭爆发样样精通。',
    features: [
      { lv: 1, name: '偷袭', desc: '攻击与盟友相邻的敌人时+1d6伤害' },
      { lv: 2, name: '狡黠动作', desc: '疾走/撤离/躲藏可作为附赠动作' },
      { lv: 3, name: '致命偷袭', desc: '偷袭伤害提升至2d6' },
    ] },
  { id: 'cleric', name: '牧师', icon: '✨', hitDie: 8, hpPerLv: 5, main: 'WIS', ac: 15, armor: '鳞甲(敏捷+2)',
    skills: ['medicine', 'religion'], weapons: [{ id: 'mace', name: '硬头锤', dice: '1d6', mod: 'STR', range: 1 }],
    spells: ['sacredflame', 'healingword', 'bless'],
    desc: '圣光的仆从，队伍最可靠的奶妈与祝福来源。',
    features: [
      { lv: 1, name: '神恩', desc: '2个1环法术位；戏法无限' },
      { lv: 2, name: '引导神力', desc: '每章1次：立即治疗2d8+WIS' },
      { lv: 3, name: '神圣打击', desc: '圣光伤害+1d8' },
    ] },
  { id: 'ranger', name: '游侠', icon: '🏹', hitDie: 10, hpPerLv: 6, main: 'DEX', ac: 14, armor: '皮甲(敏捷+2)',
    skills: ['survival', 'perception'], weapons: [{ id: 'longsword2', name: '长剑', dice: '1d8', mod: 'DEX', range: 1 }, { id: 'rangerbow', name: '长弓', dice: '1d8', mod: 'DEX', range: 15 }],
    desc: '荒野猎手，远程精准打击与生存专家。',
    features: [
      { lv: 1, name: '宿敌', desc: '对哥布林类敌人伤害+1' },
      { lv: 2, name: '猎人印记', desc: '每场战斗1次：标记敌人，对其伤害+1d6' },
      { lv: 3, name: '神射', desc: '长弓暴击范围19-20' },
    ] },
];

export const MAX_STAT = 15, MIN_STAT = 8, POINT_POOL = 27;
