// 离线旁白引擎：按人设模板渲染叙述文本
// F-37：轮换机制——同一事件依次取不同变体（不再随机重复），defaultVoice 语料池扩充
import { personaById } from './personas.mjs';

export function fill(tpl, ctx = {}) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined && ctx[k] !== null ? String(ctx[k]) : m));
}

export function offlineNarrate(personaId, eventKey, ctx = {}, idx = 0) {
  const p = personaById(personaId);
  const arr = (p.voice && p.voice[eventKey]) || [];
  let tpl;
  if (arr.length) tpl = arr[idx % arr.length]; // 人设语料轮换
  else {
    const def = defaultVoice(eventKey);
    tpl = def[idx % def.length];
  }
  return fill(tpl, ctx);
}

export function defaultVoice(key) {  const map = {
    intro: ['冒险开始了。', '新的旅途就此展开。', '骰子已备好，故事即将开场。'],
    chapterStart: ['新的章节：{place}。', '你们抵达了{place}。', '眼前的景象写着：{place}。'],
    combatStart: ['战斗开始！', '剑已出鞘，敌意已现！', '敌人扑了上来——进入战斗！', '兵器相撞的脆响划破空气，战斗骤然爆发！', '阴影中杀机毕露，双方瞬间绞杀在一起！', '没有警告，没有退路——战斗打响！'],
    roundStart: ['——第{n}回合。', '第{n}轮交锋。', '第{n}回合，战况胶着。', '——第{n}回合，双方重新拉开架势。', '第{n}轮，喘息未定，兵刃再起。', '——第{n}回合，胜负依旧悬而未决。'],
    attack: ['{actor}攻击{target}。', '{actor}朝{target}出手！', '{actor}锁定了{target}。', '{actor}踏步上前，向{target}挥出凌厉一击！', '{actor}抓住破绽，直取{target}！', '{actor}压低重心，朝着{target}猛扑过去！'],
    hit: ['命中，{dmg}点伤害。', '这一击结结实实——{dmg}点伤害！', '{target}吃下{dmg}点伤害。', '闷响声中，{target}被击退半步，{dmg}点伤害！', '锋刃撕开防御，{target}受到{dmg}点伤害！', '这一击又快又沉，{target}承受了{dmg}点伤害！'],
    miss: ['未命中。', '攻击落空了。', '差之毫厘，{target}躲了过去。', '武器擦着{target}掠过，落了空。', '{target}侧身一闪，这一击落空了。', '铛的一声，攻击被{target}格开了。'],
    crit: ['重击！{dmg}点伤害！', '致命一击！{dmg}点伤害！', '会心一击——{dmg}点伤害！', '轰！无可匹敌的一击，{dmg}点伤害！', '完美的一击贯穿防御——{dmg}点伤害！', '这是足以载入战史的一击！{dmg}点伤害！'],
    fumble: ['大失败！', '糟糕，这一下完全挥空了！', '武器差点脱手，攻击彻底落空。', '哎呀——武器险些飞出去，彻底失手！', '重心一歪，这一击摔了个七零八落。', '大失败！连站姿都乱了套。'],
    down: ['{actor}倒下了。', '{actor}失去意识，倒在地上。', '{actor}倒了下去，生死未卜。', '{actor}膝盖一软，重重栽倒在地！', '{actor}支撑不住，颓然倒地，不省人事。', '一声闷哼，{actor}倒在血泊之中。'],
    death: ['{actor}死了。', '{actor}的呼吸停止了。', '{actor}永远地倒下了。', '{actor}的目光渐渐涣散，再无声息。', '{actor}倒下了，这一次再也没能站起来。', '战至最后一刻，{actor}溘然长逝。'],
    kill: ['{target}被击败。', '{target}倒下了。', '{target}被解决掉了。', '{target}踉跄两步，轰然倒地。', '{target}发出最后的嘶吼，瘫软在地。', '尘埃落定——{target}被彻底击倒。'],
    heal: ['{target}恢复{hp}点生命。', '{target}的伤口愈合了（+{hp}）。', '治疗生效，{target}回复{hp}点生命。', '柔和的光芒拂过，{target}恢复{hp}点生命。', '{target}的呼吸平稳下来，回复{hp}点生命。', '伤痛消退，{target}重新振作（+{hp}）。'],
    search: ['{actor}搜索了四周。', '{actor}仔细翻找着。', '{actor}开始搜查。'],
    found: ['发现了{item}。', '找到了——{item}！', '搜寻有了收获：{item}。'],
    chest: ['{actor}打开了宝箱，获得{item}。', '箱盖打开，里面是{item}。', '宝箱开启！{item}到手。'],
    npcTalk: ['{actor}与{target}交谈。', '{actor}走向{target}搭话。', '{target}注意到了{actor}。'],
    levelUp: ['{actor}升到了{n}级！', '{actor}突破了，晋升{n}级！', '光芒一闪，{actor}升到{n}级。'],
    rest: ['队伍休息了一会儿。', '众人停下脚步，稍作休整。', '队伍围坐下来喘息片刻。'],
    travel: ['队伍前往{place}。', '你们动身前往{place}。', '下一站：{place}。'],
    goalAssign: ['每人都收到了一个隐藏目标。', '命运在每个人耳边低语。'],
    claimConfirm: ['{actor}的隐藏目标达成了！', '{actor}的目标被确认达成。'],
    claimDeny: ['{actor}的隐藏目标尚未达成。', '还差一点，{actor}的目标尚未达成。'],
    victory: ['胜利！', '你们赢了！', '胜利属于你们！', '敌人尽数倒下——胜利！', '尘埃落定，凯旋属于你们！', '欢呼吧！这场胜利属于每一位冒险者！'],
    defeat: ['冒险失败了……', '全军覆没……', '队伍倒下了，冒险就此终结。', '黑暗吞没了最后一丝抵抗……冒险失败。', '无人幸免，这次冒险以悲剧告终。', '队伍倒下了……但故事未必就此终结。'],
    kick: ['{actor}离开了队伍。', '{actor}被移出了队伍。'],
    // F-30/F-29：BOSS遭遇/逃跑/营地
    bossSpotted: ['{actor}发现了你们——它的视线仿佛无穷无尽，一场恶战在所难免。', '{actor}现身了！它的眼睛锁定了你们每一个人。'],
    fleeSuccess: ['你们在混乱中成功脱身，一路逃回了营地。', '你们甩开了追兵，安全撤回营地。'],
    campStart: ['{actor}点燃了篝火，大家围坐下来，享受片刻安宁。', '篝火噼啪作响，队伍在营地安顿下来。'],
  };
  return map[key] || ['……'];
}
