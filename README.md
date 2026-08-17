# 🎲 骰与篝火 · AI DM 像素跑团（DNDAgentSystem）

一款由 **AI DM 主持**的 DND 5E 像素风 WEB 联机跑团游戏。
最多 **5 名玩家**开房联机，从 **12 位性格迥异的 AI DM** 中选择主持人，
在《凡杜尔失落矿坑》（官方新手套组冒险）中车卡、探索、战斗，
完成**公开胜利目标**，或各自达成开局下发的**私密隐藏目标**。

## ✨ 核心玩法

| 系统 | 说明 |
|---|---|
| 联机房间 | 玩家可建房/进房，最多5人，房主全程可踢人，断线自动重连 |
| AI DM | 12位人设（老派法师城主/吟游诗人/黑暗学者/矮人战帅/晨曦修女/冷面佣兵/侦探/哥特诗人/地精小丑/荒野德鲁伊/虚空低语者/圣骑士诗人），各自有独立的主持风格、规则严格度、难度与旁白模板；接入OpenAI兼容API后由大模型驱动（阅读规则书摘要裁定），无Key自动降级为离线模板DM |
| 副本 | 《凡杜尔失落矿坑》：序章哥布林伏击 → 克拉格莫洞穴救西达尔 → 凡达林镇调查红标帮 → 特雷森达庄园击败格拉斯塔夫 → 克拉格莫城堡救冈德伦 → 回声波洞穴决战黑蜘蛛涅兹纳尔 |
| 车卡 | 简化快速车卡：8种族×5职业、27点线性购点、外观像素换装、实时预览 |
| 回合战斗 | 先攻掷骰、移动/攻击/施法/疾走/躲藏/搜索/短休、重击/大失败、倒地死亡豁免、法术位、升级特性（二打/偷袭/龙息…） |
| 隐藏目标 | 开局AI DM根据剧本+车卡给每人下发1个**仅自己可见**的隐藏目标；宣称达成由DM裁定；**公开目标达成或全员隐藏目标达成即胜利**，全灭则失败 |
| 像素画面 | 全程序化绘制：16px tileset、角色/怪物像素小人、行走动画、漂浮伤害、篝火/水晶动画，零图片资源 |

## 🚀 启动

\`\`\`bash
npm install          # 依赖（ws, pdfjs-dist）
node tools/extract-pdf.mjs   # （可选）提取两本规则书文本供AI DM检索
npm start            # 默认 http://localhost:3000
\`\`\`

多开浏览器窗口（或不同设备访问同一地址）即可联机。

### 接入大模型（可选，强烈推荐）

复制 \`config.example.json\` 为 \`config.json\` 并填写任意 OpenAI 兼容 API：

\`\`\`json
{
  "port": 3000,
  "seed": null,
  "llm": {
    "baseURL": "https://api.deepseek.com/v1",
    "apiKey": "你的KEY",
    "model": "deepseek-chat",
    "temperature": 0.8,
    "timeoutMs": 45000
  }
}
\`\`\`

也可用环境变量：\`DND_LLM_BASE_URL\` / \`DND_LLM_KEY\` / \`DND_LLM_MODEL\` / \`DND_PORT\` / \`DND_SEED\` / \`DND_OFFLINE=1\`。
未配置 Key 时自动使用**离线模板DM**（12人设各有专属旁白风格），游戏完整可玩。

## 🧪 模拟测试（游戏启动→结束全流程）

\`\`\`bash
npm run sim   # 协议级：5个机器人建房→车卡→自动开局→战斗/对话/宝箱→断线重连→游戏中踢人→公开目标胜利→返回房间
npm run e2e   # 浏览器级：5个真实Chromium页面走完整UI流程并截图到 e2e-shots/
\`\`\`

## 📁 目录结构

\`\`\`
server/                服务端
  index.mjs            HTTP静态+WebSocket入口
  game/rooms.mjs       房间状态机(准备/开场/游戏中/结算)
  game/game.mjs        回合制游戏引擎(战斗/法术/对话/胜负)
  game/dungeon.mjs     《凡杜尔失落矿坑》全部内容(ASCII地图/怪物/NPC)
  game/charsheet.mjs   车卡派生
  game/hiddengoals.mjs 隐藏目标模板与验证
  dm/personas.mjs      12位AI DM人设
  dm/director.mjs      AI DM导演(LLM+离线降级)
  dm/narrator.mjs      离线旁白模板
  llm.mjs              OpenAI兼容客户端
  rules/rulesdb.mjs    5E规则速查
public/                网页客户端(纯ES模块+Canvas像素渲染)
shared/autoplay-policy.mjs  自动游玩策略(机器人/浏览器共用)
simulate/              全流程模拟测试
tools/                 PDF提取/地图校验
data/rules/            规则书提取文本(由extract-pdf生成)
\`\`\`

## 🎲 规则依据

- 《5E D&D 新手套组规则书》与《城主指南》（工作目录PDF），
  \`node tools/extract-pdf.mjs\` 提取原文供 AI DM 引用，
  \`server/rules/rulesdb.mjs\` 内置核心规则速查（攻击/豁免/优势劣势/死亡豁免/休息等）。
