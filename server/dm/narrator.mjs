// 离线旁白引擎：按人设模板渲染叙述文本
import { pick } from '../util.mjs';
import { personaById } from './personas.mjs';

export function fill(tpl, ctx = {}) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined && ctx[k] !== null ? String(ctx[k]) : m));
}

export function offlineNarrate(personaId, eventKey, ctx = {}) {
  const p = personaById(personaId);
  const arr = (p.voice && p.voice[eventKey]) || [];
  const tpl = arr.length ? pick(arr) : defaultVoice(eventKey);
  return fill(tpl, ctx);
}

function defaultVoice(key) {
  const map = {
    intro: '冒险开始了。', chapterStart: '新的章节：{place}。', combatStart: '战斗开始！', roundStart: '——第{n}回合。',
    attack: '{actor}攻击{target}。', hit: '命中，{dmg}点伤害。', miss: '未命中。', crit: '重击！{dmg}点伤害！', fumble: '大失败！',
    down: '{actor}倒下了。', death: '{actor}死了。', kill: '{target}被击败。', heal: '{target}恢复{hp}点生命。',
    search: '{actor}搜索了四周。', found: '发现了{item}。', chest: '{actor}打开了宝箱，获得{item}。',
    npcTalk: '{actor}与{target}交谈。', levelUp: '{actor}升到了{n}级！', rest: '队伍休息了一会儿。', travel: '队伍前往{place}。',
    goalAssign: '每人都收到了一个隐藏目标。', claimConfirm: '{actor}的隐藏目标达成了！', claimDeny: '{actor}的隐藏目标尚未达成。',
    victory: '胜利！', defeat: '冒险失败了……', kick: '{actor}离开了队伍。',
    // F-30/F-29：BOSS遭遇/逃跑/营地
    bossSpotted: '{actor}发现了你们——它的视线仿佛无穷无尽，一场恶战在所难免。',
    fleeSuccess: '你们在混乱中成功脱身，一路逃回了营地。',
    campStart: '{actor}点燃了篝火，大家围坐下来，享受片刻安宁。',
  };
  return map[key] || '……';
}
