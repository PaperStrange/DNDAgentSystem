// 5E规则速查库：基于新手套组规则书整理，供AI DM(LLM)引用与离线裁定
// 完整原文见 data/rules/*.txt（由 tools/extract-pdf.mjs 提取）

export const RULES_REFERENCE = `
【DND 5E 核心规则速查】
1. 属性与调整值：属性10-11→+0，12-13→+1，14-15→+2，16-17→+3，18-19→+4（调整值=(属性-10)/2向下取整）。六维：力量STR(近战攻击/运动)、敏捷DEX(远程/先攻/闪避/潜行)、体质CON(生命值)、智力INT(法师/调查/奥秘)、感知WIS(察觉/牧师)、魅力CHA(交涉)。
2. 熟练加值：1-4级为+2。攻击掷骰=1d20+熟练(若武器熟练)+属性调整值；对抗护甲等级AC，≥AC即命中。
3. 先攻：1d20+敏捷调整值，高者先动。突袭：被突袭方第一轮无法行动。
4. 回合行动：每回合可【移动】(不超过速度，1格=5尺)+【动作】(攻击/施法/疾走/撤离/躲藏/协助/搜索/使用物件)+【附赠动作】(职业特性/某些法术)。攻击掷出自然20=重击(伤害骰翻倍)，自然1=自动失手。
5. 优势/劣势：优势掷2d20取高，劣势取低，同时存在则抵消。
6. 生命与死亡：生命值降至0即倒地昏迷，倒地后每回合掷死亡豁免1d20：10+成功，1-9失败；3成功=伤势稳定，3失败=死亡；自然20=以1点生命苏醒。治疗可令其苏醒。
7. 休息：短休1小时，可消耗生命骰(1d职业骰+体质调整值)恢复生命；长休8小时回满并恢复法术位。
8. 技能检定：1d20+属性调整值(+熟练)。常用DC：非常简单5/简单10/中等15/困难20/极难25。察觉(感知)看穿陷阱与潜行，调查(智力)搜索线索，巧手(敏捷)开锁扒窃，潜行(敏捷)隐蔽，说服/欺瞒/威吓(魅力)交涉。
9. 豁免：1d20+属性调整值(+熟练)。法术或陷阱常要求目标进行豁免(如敏捷豁免躲开火焰，体质豁免抵抗毒素)，DC=施法者法术豁免DC。
10. 法术位：1级法师/牧师有2个1环法术位，施放消耗，长休恢复；戏法(0环)无限施放。
11. 常见状态：倒地(近战攻击有优势/远程劣势)、麻痹(无法行动)、中毒(攻击与豁免劣势)、目盲(攻击劣势且被打有优势)、震慑(无法行动)。
12. 伤害类型：挥砍/穿刺/钝击/火焰/寒冷/闪电/毒素/强酸/光耀/暗蚀。对相应伤害有抗性者伤害减半，免疫者无效。
13. 移动与地形：困难地形每格消耗2格移动；夹击可选规则：两名盟友夹住敌人时攻击获得优势。
14. 怪物规则：怪物拥有挑战等级CR，CR越高越强；城主应让遭遇难度与队伍等级相称(1级队伍可应付4只哥布林或1只熊地精)。
15. 裁定原则：城主(DM)拥有最终裁定权；玩家行动描述越具体，越应给予优势或降低DC；鼓励创造性的非战斗解法。
`;

export const SKILLS = [
  { id: 'athletics', name: '运动', attr: 'STR' }, { id: 'acrobatics', name: '杂技', attr: 'DEX' },
  { id: 'sleight', name: '巧手', attr: 'DEX' }, { id: 'stealth', name: '潜行', attr: 'DEX' },
  { id: 'arcana', name: '奥秘', attr: 'INT' }, { id: 'history', name: '历史', attr: 'INT' },
  { id: 'investigation', name: '调查', attr: 'INT' }, { id: 'nature', name: '自然', attr: 'INT' },
  { id: 'religion', name: '宗教', attr: 'INT' }, { id: 'animal', name: '驯兽', attr: 'WIS' },
  { id: 'insight', name: '洞察', attr: 'WIS' }, { id: 'medicine', name: '医药', attr: 'WIS' },
  { id: 'perception', name: '察觉', attr: 'WIS' }, { id: 'survival', name: '生存', attr: 'WIS' },
  { id: 'deception', name: '欺瞒', attr: 'CHA' }, { id: 'intimidation', name: '威吓', attr: 'CHA' },
  { id: 'performance', name: '表演', attr: 'CHA' }, { id: 'persuasion', name: '说服', attr: 'CHA' },
];
export const skillName = (id) => (SKILLS.find(s => s.id === id) || {}).name || id;
export const ATTRS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
export const ATTR_NAMES = { STR: '力量', DEX: '敏捷', CON: '体质', INT: '智力', WIS: '感知', CHA: '魅力' };
export const attrMod = (v) => Math.floor((v - 10) / 2);
