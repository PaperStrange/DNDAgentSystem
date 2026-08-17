// 《凡杜尔失落矿坑》Lost Mine of Phandelver —— 完整副本内容
// 地图采用ASCII画法：#墙 .地板 g草地 T树 ^碎石(困难地形) ~水 D门 S玩家出生点 X出口 C宝箱 *可搜索点 F篝火 Z剧情目标物
// 生物/NPC用单字符key，经legend映射到怪物目录/NPC目录。标记字符所在格子自动变为可行走地板。

export const MONSTERS = {
  goblin: { key: 'goblin', name: '哥布林', icon: '👺', ac: 15, hp: 7, speed: 6, xp: 50, gold: '1d8+3', size: 1,
    attacks: [{ id: 'scimitar', name: '短弯刀', bonus: 4, dmg: '1d6+2', range: 1 }, { id: 'bow', name: '短弓', bonus: 4, dmg: '1d6+2', range: 12 }],
    desc: '绿皮小恶棍，成群结队，欺软怕硬。' },
  wolf: { key: 'wolf', name: '饿狼', icon: '🐺', ac: 13, hp: 11, speed: 7, xp: 50, gold: 0, size: 1,
    attacks: [{ id: 'bite', name: '啮咬', bonus: 4, dmg: '2d4+2', range: 1, onHit: { save: 'STR', dc: 11, effect: '击倒' } }],
    desc: '克拉格养的凶狼，牙尖爪利。' },
  klarg: { key: 'klarg', name: '克拉格', icon: '👹', ac: 15, hp: 22, speed: 6, xp: 200, gold: '2d10+10', size: 1, boss: true,
    attacks: [{ id: 'morningstar', name: '晨星锤', bonus: 4, dmg: '2d8+2', range: 1 }],
    desc: '克拉格莫洞穴的熊地精头目，洞穴的主人。' },
  ruffian: { key: 'ruffian', name: '红标帮打手', icon: '🥷', ac: 14, hp: 16, speed: 6, xp: 100, gold: '1d10+5', size: 1,
    attacks: [{ id: 'ssword', name: '短剑', bonus: 4, dmg: '1d6+2', range: 1, multi: 2 }, { id: 'sbow', name: '短弓', bonus: 4, dmg: '1d6+2', range: 10 }],
    desc: '红标帮的恶棍，披着猩红披风横行乡里。' },
  glasstaff: { key: 'glasstaff', name: '格拉斯塔夫', icon: '🧙‍♂️', ac: 12, hp: 22, speed: 6, xp: 300, gold: '3d10+15', size: 1, boss: true,
    attacks: [{ id: 'firebolt', name: '火焰箭', bonus: 4, dmg: '1d10', range: 12, magic: true },
              { id: 'missiles', name: '魔法飞弹', bonus: 0, dmg: '3d4+3', range: 12, autoHit: true, magic: true }],
    desc: '红标帮的首领，手持玻璃法杖的堕落法师。' },
  hobgoblin: { key: 'hobgoblin', name: '霍布哥布林', icon: '🪖', ac: 18, hp: 11, speed: 6, xp: 100, gold: '1d10+8', size: 1,
    attacks: [{ id: 'longsword', name: '长剑', bonus: 3, dmg: '1d8+1', range: 1 }],
    desc: '纪律严明的哥布林近亲，身披鳞甲。' },
  bugbear: { key: 'bugbear', name: '熊地精', icon: '🐻', ac: 16, hp: 24, speed: 6, xp: 200, gold: '2d10+10', size: 1,
    attacks: [{ id: 'morningstar', name: '晨星锤', bonus: 4, dmg: '2d8+2', range: 2 }],
    desc: '毛茸茸的大块头，臂展惊人。' },
  grol: { key: 'grol', name: '王·戈洛尔', icon: '👑', ac: 16, hp: 28, speed: 6, xp: 350, gold: '4d10+20', size: 1, boss: true,
    attacks: [{ id: 'greatclub', name: '巨棒', bonus: 5, dmg: '2d8+3', range: 1 }],
    desc: '克拉格莫城堡的熊地精之王，冈德伦的看守者。' },
  doppelganger: { key: 'doppelganger', name: '变形怪', icon: '🎭', ac: 14, hp: 20, speed: 6, xp: 250, gold: '2d10+10', size: 1,
    attacks: [{ id: 'slam', name: '猛击', bonus: 5, dmg: '2d6+3', range: 1 }],
    desc: '能变作他人模样的诡诈生物，戈洛尔的座上宾。' },
  skeleton: { key: 'skeleton', name: '骷髅兵', icon: '💀', ac: 13, hp: 13, speed: 6, xp: 75, gold: 0, size: 1, undead: true,
    attacks: [{ id: 'sbow', name: '短弓', bonus: 4, dmg: '1d6+2', range: 10 }, { id: 'ssword', name: '短剑', bonus: 4, dmg: '1d6+2', range: 1 }],
    desc: '百年前矿难矿工的遗骸，仍守护着洞穴。' },
  zombie: { key: 'zombie', name: '僵尸', icon: '🧟', ac: 8, hp: 18, speed: 4, xp: 75, gold: 0, size: 1, undead: true,
    attacks: [{ id: 'slam', name: '猛击', bonus: 3, dmg: '1d6+1', range: 1 }],
    desc: '蹒跚的亡者，生命力顽强得诡异。' },
  giantspider: { key: 'giantspider', name: '巨蜘蛛', icon: '🕷️', ac: 14, hp: 20, speed: 6, xp: 200, gold: 0, size: 1,
    attacks: [{ id: 'bite', name: '毒牙', bonus: 5, dmg: '1d8+3', range: 1, poison: { save: 'CON', dc: 11, dmg: '2d6', type: '毒素' } }],
    desc: '回声波洞穴的原住民，涅兹纳尔的宠物。' },
  nezznar: { key: 'nezznar', name: '涅兹纳尔', icon: '🕸️', ac: 15, hp: 24, speed: 6, xp: 450, gold: '6d10+40', size: 1, boss: true, finalBoss: true,
    attacks: [{ id: 'staff', name: '蜘蛛法杖', bonus: 5, dmg: '1d8+3', range: 1 },
              { id: 'darkbolt', name: '暗蚀箭', bonus: 5, dmg: '2d6', range: 12, magic: true },
              { id: 'web', name: '蛛网术', bonus: 0, dmg: 0, range: 8, web: { save: 'DEX', dc: 13 } }],
    desc: '黑蜘蛛涅兹纳尔，卓尔法师。窃据法术熔炉的元凶，凡杜尔一切灾祸的幕后黑手。' },
};

export const ITEMS = {
  potion: { id: 'potion', name: '治疗药水', icon: '🧪', price: 50, desc: '附赠动作使用：恢复2d4+2生命。', heal: '2d4+2', target: 'ally' },
  flask: { id: 'flask', name: '炼金火焰瓶', icon: '🧨', price: 40, desc: '动作使用：投掷3x3范围，2d6火焰伤害，敏捷豁免减半。', aoe: { size: 3, dmg: '2d6', type: '火焰', save: 'DEX', dc: 13 } },
};

// NPC目录：id -> {name, icon, sprite, dialogue}
export const NPCS = {
  sildar: { id: 'sildar', name: '西达尔·霍尔温特', icon: '🛡️', title: '战士·领主同盟代理人',
    greet: '呼……谢天谢地，是活人。我是西达尔·霍尔温特，来自深水城。我和矮人兄弟冈德伦·岩寻一起寻找失落的回声波洞穴，路上遭了哥布林伏击。冈德伦被他们抓走了！',
    options: [
      { id: 'rescue', text: '[解救] 打开笼子，放他出来', tag: 'aid', need: 'cage_key', missingText: '笼子被铁锁锁着。你们需要找到钥匙。', once: true,
        result: { flag: 'rescue_sildar', gold: 10, log: '西达尔获救。他告诉你们：冈德伦被带去了北边的克拉格莫城堡，而红标帮正盘踞在凡达林镇胡作非为。他建议先去凡达林镇打探消息。' } },
      { id: 'ask', text: '[洞察] 询问伏击详情', tag: 'insight', result: { log: '西达尔回忆道："带头的是个叫克拉格的熊地精。冈德伦知道矿坑入口的秘密，他们不会轻易杀他。"' } },
      { id: 'thanks', text: '问他是否认识凡达林镇的人', result: { log: '西达尔点头："到了镇上找酒馆老板托布伦，还有杂货铺的巴森。报我的名字，他们会帮你们的。"' } },
    ] },
  barthen: { id: 'barthen', name: '巴森·格雷温德', icon: '🧺', title: '杂货铺老板',
    greet: '哦！旅行者！欢迎来到巴森杂货铺。凡达林最近不太平，红标帮那帮混蛋……算了，看看货吧。报西达尔的名字？那给你们打个折。',
    options: [
      { id: 'buy_potion', text: '[购买] 治疗药水（50金）', tag: 'trade', cost: { gold: 50, item: 'potion' }, result: { log: '巴森笑着递过一瓶泛红的药水。' } },
      { id: 'buy_flask', text: '[购买] 炼金火焰瓶（40金）', tag: 'trade', cost: { gold: 40, item: 'flask' }, result: { log: '巴森小心翼翼地包好一个陶瓶："扔之前先拔塞子！"' } },
      { id: 'info', text: '[调查] 打听红标帮的消息', tag: 'investigation', result: { flag: 'town_info', log: '巴森压低声音："红标帮的老巢在特雷森达庄园，就藏在镇子东边山丘下。他们头儿叫格拉斯塔夫，是个会使法术的家伙。镇上的议员托布伦一直想找人收拾他们。"' } },
    ] },
  toblen: { id: 'toblen', name: '托布伦·石丘', icon: '🍺', title: '酒馆老板·镇议员',
    greet: '随便坐！凡达林石丘酒馆欢迎所有带钱的朋友——以及所有不带红披风的朋友。',
    options: [
      { id: 'info', text: '[说服] 请他谈谈镇子的困境', tag: 'persuasion', result: { flag: 'town_info', gold: 0, log: '托布伦叹了口气："红标帮杀了我的一个雇工。他们从特雷森达庄园地下的藏身处出来活动。谁能除掉格拉斯塔夫，凡达林愿意出一百金！"（隐藏线索：红标帮头目格拉斯塔夫藏在庄园地窖）' } },
      { id: 'heal', text: '要一杯热汤（免费回复5点生命）', tag: 'aid', once: true, heal: 5, result: { log: '热腾腾的肉汤下肚，浑身暖和了起来。' } },
    ] },
  linene: { id: 'linene', name: '林尼尼·灰风', icon: '⚙️', title: '狮鹫商行店长',
    greet: '狮鹫商行，狮鹫商行！上好的武器防具！——虽然最近进货的商队全被哥布林抢了，库存嘛……你懂的。',
    options: [
      { id: 'info', text: '[洞察] 问商队被劫的细节', tag: 'insight', result: { flag: 'town_info', log: '林尼尼愤愤地说："商队在贡树大道被抢，我的货全没了！都是红标帮和哥布林干的好事。听说北边克拉格莫城堡里，还关着个重要人物。"' } },
      { id: 'buy', text: '[购买] 附魔磨刀石（80金，攻击伤害+1）', tag: 'trade', cost: { gold: 80, upgrade: 'weapon' }, once: true, result: { log: '林尼尼仔细地为你的武器开刃附魔。你的攻击伤害+1！' } },
    ] },
  galaelle: { id: 'galaelle', name: '修女加拉埃勒', icon: '⛪', title: '晨曦神庙祭司',
    greet: '愿晨曦之神照亮你们的路。我是加拉埃勒。受伤的旅人，神庙的大门永远敞开。',
    options: [
      { id: 'heal', text: '[宗教] 请求神恩治疗（回复10点生命）', tag: 'religion', once: true, heal: 10, result: { log: '温暖的圣光笼罩全身，伤口以肉眼可见的速度愈合。' } },
      { id: 'info', text: '询问不死的传闻', tag: 'religion', result: { flag: 'town_info', log: '加拉埃勒神色凝重："东边的老橡树下住着占卜的老妇人。她说山里有座失落矿坑，矿坑里……有不干净的东西爬了出来。"' } },
    ] },
  oldhag: { id: 'oldhag', name: '神秘老妪', icon: '🔮', title: '占卜者',
    greet: '嘿嘿……五个影子，一条路。老婆子我啊，早就算到你们会来。',
    options: [
      { id: 'fortune', text: '[奥秘] 请她占卜命运', tag: 'arcana', once: true, result: { flag: 'fortune_told', log: '老妪盯着你们的眼睛，声音忽然变得遥远："黑蜘蛛盘踞矿坑深处，熔炉之光将熄。岩寻之血，会为你们打开最后的大门。击败黑蜘蛛者，凡杜尔永世传颂。"' } },
      { id: 'ask', text: '问她红标帮的事', tag: 'insight', result: { flag: 'town_info', log: '老妪咯咯笑道："披红斗篷的豺狼，躲在地下的庄园。他们怕火，也怕比他们更狠的人。"' } },
    ] },
  gundren: { id: 'gundren', name: '冈德伦·岩寻', icon: '⛏️', title: '矮人探险家',
    greet: '咳……你们是谁？来救我的？！好样的！我冈德伦·岩寻欠你们一条命！',
    options: [
      { id: 'rescue', text: '[解救] 打开牢门', tag: 'aid', need: 'castle_key', missingText: '牢门被重锁锁着。钥匙在城堡的主人身上。', once: true,
        result: { flag: 'rescue_gundren', gold: 25, log: '冈德伦重获自由！他激动地告诉你们："回声波洞穴的入口就在城堡北边的山崖下！黑蜘蛛涅兹纳尔已经抢先一步进去了——他想要洞穴深处的法术熔炉！快，不能让他得逞！"' } },
      { id: 'ask', text: '询问矿坑的秘密', tag: 'investigation', result: { log: '冈德伦低声道："矿坑里有矮人先民的符文机关。记住：门，会向矮人血脉敞开。我没事，你们快去吧。"' } },
    ] },
  prisoner: { id: 'prisoner', name: '被囚的村民', icon: '🧑‍🌾', title: '凡达林村民',
    greet: '……别杀我！我是凡达林的农户，红标帮抓我来当苦力。',
    options: [
      { id: 'free', text: '[解救] 放他走', tag: 'aid', once: true, result: { flag: 'rescue_villager', log: '村民千恩万谢地逃了出去。他回头喊了一句："格拉斯塔夫有个密室，入口在书房的书架后面！"' } },
    ] },
};

// 章节定义
export const DUNGEONS = [{
  id: 'lmop',
  name: '凡杜尔失落矿坑',
  subtitle: 'Lost Mine of Phandelver',
  icon: '⛏️',
  desc: '新手套组官方冒险。护送矮人兄弟的商队在贡树大道遭袭，失踪、阴谋与一座失落矿坑的秘密正等着你们。适合1级出发的新手队伍。',
  publicGoal: { id: 'beat_nezznar', text: '【公开目标】深入回声波洞穴，击败黑蜘蛛涅兹纳尔，夺回法术熔炉，拯救凡杜尔。' },
  chapters: [
    {
      id: 'prologue', name: '序章·哥布林之箭', place: '贡树大道岔路口',
      intro: '你们受雇护送矮人兄弟冈德伦·岩寻的物资马车，前往凡达林镇。行至贡树大道岔路口，只见马车翻倒、货物散落，两匹死马倒在路旁——箭矢插满马身。矮人兄弟，不见了。',
      objective: { id: 'clear_ambush', text: '击退伏击的哥布林，搜寻线索', doneHint: '伏击者已被肃清。沿着足迹，通往北方的道路打开了。' },
      map: {
        w: 26, h: 13,
        legend: { M: 'goblin', S: 'spawn', X: 'exit', C: 'chest', T: 'tree' },
        ascii: [
          '##########################',
          '#.....g........g......T..#',
          '#.g.....T..g..........g..#',
          '#.....M...g.....T...g....#',
          '#g..g......T....g......g.#',
          '#.T.....g....g...g......^#',
          '#.....g...S....g...g..T..#',
          '#.g..g...S....g.....g....#',
          '#..T....S......T....g....#',
          '#.....g.S.....g....S..g..#',
          '#..g......g......T....g..#',
          '#......T....g........X...#',
          '##########################',
        ],
      },
      spawns: 'auto',
      exit: { key: 'X', to: 'ch1', label: '沿着哥布林的足迹，前往克拉格莫洞穴', need: 'clear_ambush' },
      chests: [{ key: 'C', gold: '2d10+10', desc: '被掀翻的货箱' }],
      monsters: [
        { def: 'goblin', squad: 'ambush', count: 4 },
      ],
      boss: null,
      levelUpTo: 2,
    },
    {
      id: 'ch1', name: '第一章·克拉格莫洞穴', place: '克拉格莫洞穴',
      intro: '顺着足迹，你们摸进了哥布林的巢穴——克拉格莫洞穴。洞内昏暗潮湿，远处传来哥布林的聒噪和狼的低吼。',
      objective: { id: 'rescue_sildar', text: '击败洞穴主人克拉格，救出被囚的西达尔', doneHint: '西达尔获救了。他说凡达林镇有红标帮作乱，冈德伦被带往北边城堡。' },
      map: {
        w: 38, h: 24,
        legend: { M: 'goblin', W: 'wolf', K: 'klarg', N: 'sildar', S: 'spawn', X: 'exit', C: 'chest', O: 'stone', R: 'rock' },
        ascii: [
          '######################################',
          '#..........g.................X....g.#',
          '#.S...g..g....g.....###..g.......g...#',
          '#...g....g...g......#...#..g....g....#',
          '#.g....g.....g....g.#...#.....g..g...#',
          '#...g......g.......g#...#..g.....g...#',
          '#..g....g.....g.....###...g......g...#',
          '#.g.....g....g..g....g.....g...g.....#',
          '#..g..g......g...M...g...g.....g.....#',
          '#.g......g...g...g.M...g..g...g..O...#',
          '#..g..g.....g...g..g...g....g...g....#',
          '#....g....g.....g.....g..g.....O..g..#',
          '#.g....g......g...g.M....g.....g.....#',
          '#..g..g....g....g......g..g....g..g..#',
          '#....g...g.....g..g..g....g.....g....#',
          '#.g...g.....W.g....g...g..g...g..g...#',
          '#..g....g....g.....g...M.g.....g.....#',
          '#....g....g.....g....g.....g....g....#',
          '#.g...S....g..g..g....g..g..g...g....#',
          '#..S...g.....g..g...g....g..g...g....#',
          '#.S...g....g...g...g..K.g....g...N..#',
          '#..S...g....g..g...g...g...g..g..g...#',
          '#.....g....g...g...C...g..g....g.....#',
          '######################################',
        ],
      },
      spawns: 'auto',
      exit: { key: 'X', to: 'town', label: '离开洞穴，前往凡达林镇', need: 'rescue_sildar' },
      chests: [{ key: 'C', gold: '2d10+15', desc: '克拉格的藏宝箱' }],
      monsters: [
        { def: 'goblin', squad: 'guard', count: 3, lootKey: 'cage_key' },
        { def: 'wolf', squad: 'den', count: 1 },
        { def: 'klarg', squad: 'boss', count: 1 },
      ],
      npcs: [{ key: 'N', def: 'sildar' }],
      boss: 'klarg',
      levelUpTo: 2,
    },
    {
      id: 'town', name: '第二章·凡达林镇', place: '凡达林镇',
      intro: '你们抵达了凡达林镇——一座被红标帮阴影笼罩的小镇。镇民们谨慎而友善，酒馆、杂货铺、神庙错落在土路两旁。',
      objective: { id: 'defeat_glasstaff', text: '打听红标帮的情报，潜入特雷森达庄园击败格拉斯塔夫', doneHint: '红标帮被击溃了。冈德伦还关在北边的克拉格莫城堡，事不宜迟。' },
      map: {
        w: 46, h: 26,
        legend: { M: 'ruffian', B: 'barthen', L: 'linene', O: 'toblen', A: 'galaelle', H: 'oldhag', S: 'spawn', X: 'exit_mansion', Y: 'exit_castle', F: 'campfire', T: 'tree' },
        ascii: [
          '##############################################',
          '#..g..g...g....g...g.....g..g.....g....g..g..#',
          '#.g...g....g...g....g....g...g....g...g...g..#',
          '#..g..T..g....g...g....g....g..g....g..g...g.#',
          '#.g......g...#####....g..g...g...#####....g..#',
          '#..g..g....g.#B...#...g....g...#L...#...g...g#',
          '#.g...g.....g#....#...g..g.....g#....#..g...g#',
          '#..g..g....g.#....#...g...g...g#....#...g...g#',
          '#.g...g.....g#....#...g..g.....g#....#..g...g#',
          '#..g..g....g.###.##...g...g...g###.##...g...g#',
          '#.g....g...g...g...S....g..g..g...g...g...g..#',
          '#..g..g....g...S..g....g...g...g..g...g..g...#',
          '#.g...g....g...g..g....#####....g..g...g..g..#',
          '#..g..g..g....g..g....#.....g#..g....g..g...g#',
          '#.g....g..g....g..g....#......#..g..g....g..g#',
          '#..g..g....g..g...g....#......#..g...g...g..g#',
          '#.g...g...g...g...g....#..O...#..g..g....g..g#',
          '#..g..g..g..g..g...g...####.###..g...g..g..g.#',
          '#.g....g....g.S.g...g..F.g...g...g..g....g..g#',
          '#..g..g..g...g...g..g...g...g...g...g..g..g..#',
          '#.g..T....g..g..g.S.g...g..g...g....g....g..g#',
          '#..g...g..g..g..g...g...A..g...g..g...T..g..#',
          '#.g..g...g..g..g...g...g..g...g....g...g..g..Y',
          '#..g..g..g..S.g...g....g...g....g..g..g...g..X',
          '#.g..g...g..g....g...g..H..g...g...g..g..g...#',
          '##############################################',
        ],
      },
      spawns: 'auto',
      exit: { key: 'X', to: 'mansion', label: '潜入特雷森达庄园（东边山丘）', need: 'town_info' },
      exit2: { key: 'Y', to: 'castle', label: '北上克拉格莫城堡', need: 'defeat_glasstaff' },
      monsters: [{ def: 'ruffian', squad: 'town', count: 2 }],
      npcs: [
        { key: 'B', def: 'barthen' }, { key: 'L', def: 'linene' }, { key: 'O', def: 'toblen' },
        { key: 'A', def: 'galaelle' }, { key: 'H', def: 'oldhag' },
      ],
      props: [{ key: 'F', type: 'campfire', desc: '镇中心的篝火。在这里可以长休。' }],
      boss: null,
      levelUpTo: 2,
    },
    {
      id: 'mansion', name: '第二章·特雷森达庄园', place: '特雷森达庄园地窖',
      intro: '你们从庄园书房的书架后找到了暗门，潜入红标帮的地下藏身处。走廊里回荡着酒杯碰撞声和粗鲁的笑声。',
      objective: { id: 'defeat_glasstaff', text: '击败红标帮首领格拉斯塔夫，捣毁藏身处', doneHint: '红标帮覆灭。镇子安全了，而冈德伦还在北边的克拉格莫城堡等待救援。' },
      map: {
        w: 34, h: 22,
        legend: { M: 'ruffian', G: 'glasstaff', P: 'prisoner', S: 'spawn', X: 'exit', C: 'chest', B: 'barrel' },
        ascii: [
          '##################################',
          '#........S.......................#',
          '#.####.#####..####...####..#####..#',
          '#.#......#....#......#......#....#',
          '#.#..B...#....#...M..#..B...#.G..#',
          '#.#......#....#......#......#....#',
          '#.#####..#....####...####...#....#',
          '#........#....#..........#..#....#',
          '#..B.....#....#...M......#..#.P..#',
          '#........#....#..........#..#....#',
          '#.####...#....#....####..#..####.#',
          '#.#......#....#....#..........#..#',
          '#.#..M...#....#....#..B...C...#..#',
          '#.#......#....#....#..........#..#',
          '#.####..###.####..###..####..##..X',
          '#............S...........#......#',
          '#..B...S...........S......B.....#',
          '#.....S...............S..........#',
          '#.......S.............S....B....#',
          '#...............................#',
          '#.............B.................#',
          '##################################',
        ],
      },
      spawns: 'auto',
      exit: { key: 'X', to: 'town', label: '返回凡达林镇' },
      chests: [{ key: 'C', gold: '3d10+20', desc: '红标帮的赃物箱' }],
      monsters: [
        { def: 'ruffian', squad: 'den', count: 3 },
        { def: 'glasstaff', squad: 'boss', count: 1 },
      ],
      npcs: [{ key: 'P', def: 'prisoner' }],
      boss: 'glasstaff',
      levelUpTo: 2,
    },
    {
      id: 'castle', name: '第三章·克拉格莫城堡', place: '克拉格莫城堡',
      intro: '破败的克拉格莫城堡矗立在荒丘之上，城墙上插着哥布林部落的旗帜。冈德伦就被关在这座要塞的深处。',
      objective: { id: 'rescue_gundren', text: '击败熊地精之王戈洛尔，救出冈德伦', doneHint: '冈德伦获救了。他指出了回声波洞穴的入口——黑蜘蛛涅兹纳尔已经抢先一步！' },
      map: {
        w: 40, h: 26,
        legend: { M: 'hobgoblin', B: 'bugbear', K: 'grol', G: 'doppelganger', N: 'gundren', S: 'spawn', X: 'exit', C: 'chest', F: 'campfire' },
        ascii: [
          '########################################',
          '#..g..g...M...g..g...g..g....g....X..g.#',
          '#.g...g...g...g...g..g...g..g..g...g...#',
          '#..g..g..g....g..g...g...g...g...g...g.#',
          '#.g...g..g..g...g....g..g...g...g..g...#',
          '#..g..g....g..g...g..g...g...g...g..g..#',
          '#.g...g..g...g...g....g..g...g...g...g.#',
          '#..g..g..g..g..g...g..g...g...g..g..g..#',
          '#.g...g...g..g.S.g....g..g...g...g..g..#',
          '#..g..g..g...g..g...g...g..g...g...g..S#',
          '#.g...g..g..g.S.g...g..g...g...g..g.S..#',
          '#..g..g...g..g...g...g...g.Sg...g..g.S.#',
          '#.g...g..g...g.S.g..g...g...g..g..S..g.#',
          '#..g.Bg...g..g...g...g...g..g...g..g..g#',
          '#.g...g...g..g...g...g...g..g...g.Bg..#',
          '#..g..g..g...g..g...g...g..g...g...g..#',
          '#.g...g..g...g...g..g...g..Kg.G...g..g#',
          '#..g..g..g...g..g...g.N.g...g..g...g..#',
          '#.g...g...g..g...g...g...g..g...g..g..#',
          '#..g..g..g...g..g...g..g...g...g...g..#',
          '#.g...g..g...g...g..g...g...g..g...g..#',
          '#..g..g..g..g...g...g..g...g...g...g..#',
          '#.g...g...g..g...g...g...g..g...g..g..#',
          '#..g..g..g...g..g...g..g...g...g...g..#',
          '#.g...g..g..g...g...g...g..g...g..g...#',
          '########################################',
        ],
      },
      spawns: 'auto',
      exit: { key: 'X', to: 'cave', label: '进入山崖下的回声波洞穴', need: 'rescue_gundren' },
      chests: [{ key: 'C', gold: '4d10+25', desc: '戈洛尔的宝箱' }],
      monsters: [
        { def: 'hobgoblin', squad: 'gate', count: 1 },
        { def: 'bugbear', squad: 'hall', count: 1 },
        { def: 'grol', squad: 'boss', count: 1, lootKey: 'castle_key' },
        { def: 'doppelganger', squad: 'boss', count: 1 },
      ],
      npcs: [{ key: 'N', def: 'gundren' }],
      boss: 'grol',
      levelUpTo: 3,
    },
    {
      id: 'cave', name: '终章·回声波洞穴', place: '回声波洞穴',
      intro: '你们踏入回声波洞穴。这里曾是矮人与侏儒的骄傲——法术熔炉的所在地。如今，黑暗中回荡着亡者的低语，而洞穴最深处，黑蜘蛛涅兹纳尔正在窃取熔炉的力量。',
      objective: { id: 'beat_nezznar', text: '击败黑蜘蛛涅兹纳尔，夺回法术熔炉', doneHint: '涅兹纳尔被击败了！法术熔炉的光芒重新亮起——凡杜尔得救了！', isPublic: true },
      map: {
        w: 48, h: 30,
        legend: { M: 'skeleton', Z: 'zombie', P: 'giantspider', N: 'nezznar', S: 'spawn', X: 'forge', C: 'chest', Y: 'crystal' },
        ascii: [
          '################################################',
          '#..........g.......Y......g..........g.........#',
          '#.S...g........g..........g......g.....g..g..g.#',
          '#....g...g.......g...g........g....g...g....g..#',
          '#.g.....g....g....S...g...g......g.......g..g..#',
          '#..g.......g....g....S...g....g..g...g....g....#',
          '#.g....g......g....g.....g......g.....g...g....#',
          '#..g.....g......g....g...g....g..g...g....g....#',
          '#.g...g....g.....g....g....g...g....g..g...g...#',
          '#..g.....g...g.....g...g....g....g...g...g..g..#',
          '#.g...g.....g...g....g.M.g...g....g.....g..g...#',
          '#..g...g.....g..g...g...g...g.....g..g...g.....#',
          '#.g....g..g....g...g...g....g...g...g..g...g...#',
          '#..g..g....g...g...g...g.Zg....g..g...g....g...#',
          '#.g...g..g...g..g...g...g...g...g...g..g...g..#',
          '#..g..g...g..g...g..g....g..g...g...g..g..g....#',
          '#.g..g...g...g..g...g.Mg...g...g..g....g...g...#',
          '#..g..g..g...g...g..g..g...g...g..g..g...g..g..#',
          '#.g..g...g..g...g...g..g...g..g...g...g..g...g.#',
          '#.g..g...g..g...g...g.Pg...g..g...g...g..g...g.#',
          '#..g..g...g..g..g...g...g..g...g..g..g...g..g..#',
          '#.g..g..g...g..g..g...g..Zg...g...g..g...g...#',
          '#..g..g..g...g...g..g...g..g..g...g..g..g...g..#',
          '#.g..g..g..g..g...g..g...g..g...g..g...g..g..g#',
          '#..g..g...g..g..g...g..g...g..g...g..g...g..g.#',
          '#.g..g..g..g...g..g...g..P..g...g..g...g..g..g#',
          '#..g..g..g..g..g..g...g..g..g..g...g..g..g..g.#',
          '#.g..g..g..g..g..g..g..g..g..g..g..g..N..g..g#',
          '#..g..g..g..g..g..g..g..g..g..g..g..g..g..g..X#',
          '################################################',
        ],
      },
      spawns: 'auto',
      exit: { key: 'X', to: null, label: '法术熔炉', interact: 'forge' },
      chests: [{ key: 'C', gold: '5d10+30', desc: '矮人先民的军械箱' }],
      monsters: [
        { def: 'skeleton', squad: 'undead', count: 2 },
        { def: 'zombie', squad: 'undead', count: 2 },
        { def: 'giantspider', squad: 'web', count: 2 },
        { def: 'nezznar', squad: 'boss', count: 1 },
      ],
      boss: 'nezznar',
      levelUpTo: 4,
    },
  ],
}];

// 解析ASCII地图。标记字符（S/X/C/怪物/NPC等）所在格子自动设为可行走地板。
export function parseMap(chapter) {
  const mapDef = chapter.map;
  const rows = mapDef.ascii;
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const tiles = [], entities = [], chests = [], props = [], spawns = [];
  const floor = () => ({ type: 'floor', blockMove: false, blockSight: false });
  let exit = null, exit2 = null;
  const markers = []; // 标记字符位置，最后统一置为地板
  const NPC_KEYS = ['barthen', 'linene', 'toblen', 'galaelle', 'oldhag', 'sildar', 'gundren', 'prisoner'];
  const PROP_KEYS = ['stone', 'rock', 'barrel', 'crystal', 'campfire'];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] || '#';
      let t = { type: 'wall', blockMove: true, blockSight: true };
      if (ch === '.' || ch === 'g') t = { type: ch === 'g' ? 'grass' : 'floor', blockMove: false, blockSight: false };
      else if (ch === '~') t = { type: 'water', blockMove: true, blockSight: false };
      else if (ch === '^') t = { type: 'rubble', blockMove: false, blockSight: false, difficult: true };
      else if (ch === 'D') t = { type: 'door', blockMove: true, blockSight: true, door: true };
      else if (ch === 'T') t = { type: 'tree', blockMove: true, blockSight: true };
      row.push(t);
      const leg = mapDef.legend[ch];
      if (!leg || leg === 'tree') continue;
      if (leg === 'spawn') spawns.push({ x, y });
      else if (leg === 'exit') exit = { ...(chapter.exit || {}), x, y };
      else if (leg === 'exit_mansion') exit = { ...(chapter.exit || {}), x, y, kind: 'mansion' };
      else if (leg === 'exit_castle') exit2 = { ...(chapter.exit2 || {}), x, y, kind: 'castle' };
      else if (leg === 'chest') { const cd = (chapter.chests || [])[chests.length]; chests.push({ ...(cd || {}), x, y }); }
      else if (leg === 'forge') exit = { ...(chapter.exit || {}), x, y, kind: 'forge' };
      else if (NPC_KEYS.includes(leg)) entities.push({ kind: 'npc', def: leg, x, y });
      else if (PROP_KEYS.includes(leg)) props.push({ x, y, type: leg });
      else entities.push({ kind: 'monster', def: leg, x, y, squad: 'auto' });
      markers.push({ x, y });
    }
    tiles.push(row);
  }
  // 标记格子 → 地板
  for (const m of markers) {
    if (tiles[m.y] && tiles[m.y][m.x]) tiles[m.y][m.x] = floor();
  }
  return { w, h, tiles, entities, chests, props, spawns, exit, exit2 };
}
