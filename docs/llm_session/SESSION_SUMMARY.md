# 会话知识压缩 · DNDAgentSystem 项目交接手册
> 新会话开始后先读本文件，即可无上下文损耗地接续工作。最后更新：20260822新增功能待优化批次（F-33~F-37，5项）完成并通过全量回归。

## 项目是什么
AI 主导的 DND 5E 像素风 WEB 联机跑团游戏。最多 5 名玩家 + 1 名 AI DM 开房联机。
核心卖点：12 位性格迥异的 AI DM 人设（LLM 在线驱动 + 离线模板降级双模式）、
《凡杜尔失落矿坑》完整主线（序章+4章）、公开目标与私密隐藏目标双胜利条件。

## 需求来源（用户原始设定 + 两批后续需求）
- 玩家/AI DM 两类角色；玩家可建房/进房；房主选副本+从 AI DM 人设中选一个主持；房主全程可踢人
- 准备阶段所有人车卡，全员就绪后自动开局；游戏界面为 2D 像素小人回合制 RPG
- 用户补充决策：OpenAI 兼容 API 驱动 DM；5玩家+1DM；人设≥10个（做了12个）；
  只做《凡杜尔失落矿坑》；简化快速车卡；胜利=公开目标达成 或 全员各自隐藏目标达成，全灭判负
- 第二批（安全）：API Key 绝不上传云端；防身份冒用/跨站/洪泛/路径穿越/隐私/提示词注入
- 第三批（体验优化，16项看板全清）：车卡三连bug修复、背景故事LLM随机、像素形象重绘带种族特征、
  自动/手动战斗模式(房主设定,默认自动)、倍速+暂停、隐藏任务无PVP规则、日志过滤高亮、背包面板、
  冒险卡片+故事集（为成就/分享/交易铺垫）
- 第四批（画面比例修复 B-8/B-9）：画布缓冲与CSS不一致导致垂直拉伸2.2~2.5倍+高度链断裂溢出视口；
  修复后三视口实测拉伸1.000、内容比例1.47/2.15/2.26；多人同格错开绘制、名字/血条/伤害数字屏幕空间化
- 第五批（BetaTest 20260818，13项）：单人体验(准备确认框+难度缩放，单人完整通关3分钟)/
  背景≥150字随机风格/车卡界面选战斗模式/隐藏目标称谓指代明确/快捷键(空格暂停·小键盘调速，仅房主)/
  玩家聊天(日志/聊天切换)/手动回合展示(回合数+行动顺序条+点击头像看行动)/
  DM裁定依据规则书且仅房主可见(ruling日志)/冒险者名册(角色状态+死亡禁战)/
  藏书室故事集(书架+高光配图)/无效按钮清理/像素轮廓细化(自动描边)
- 第六批（遗漏批次 5项）：账户系统(注册/登录/单点登录，新IP登录挤掉旧会话，登录页风格与大厅一致)/
  多分辨率布局优化(7视口自动化护栏)/代码架构调研(选型Hybrid ECS+entities/dialogue/progress系统迁移)/
  错误提示全量整理(用户友好规范+手动模式失败回显+toast去重)/
  冒险日志房主本地落盘(data/logs)+结算页导出+客户端错误环形缓冲自查面板
- 第七批（UI反馈 3项）：旧令牌失效白屏修复(拒绝路径也要下发快照+客户端自动清令牌)/
  登录流程梳理(登出后按钮立即重现+弹窗红字提示不卡死+访客幽灵清理)/
  大厅看板式间距(左列gap16px)+车卡布局重构(成员顶部横卡/车卡独占全宽/种族卡50→164px/预览吸顶修复)
- 第八批（用户实测 9项）：手动模式自动战斗修复(模式初始化标志)+预览整列吸顶/
  捏脸系统重做(发型×4/胡须/瞳色/饰色/随机外观，通用像素变换层)/
  背景故事去AI痕迹+强制第三人称+生成spinner/文案润色+隐藏目标冒号衔接+开始冒险返回按钮/
  地图剧情主题绘制(离线6章主题+AI调色板)/升级经验数值+短休剩余+本地时间与冒险时长/移除宣称按钮改结算自动判定
- 第九批（冒险内 5项）：地图全黑修复(drawTile坐标契约bug，瓦片自MVP起堆叠左上角→非暗像素0.6%→100%)/
  行动面板宣称按钮残留移除/日志自动滚动(先挂载后赋值scrollTop)/
  队伍共享线索面板(钥匙/对话情报/章节目标提示全队可查)/
  角色经验等级跨冒险继承(规则书确认累积制，名册持久化+车卡继承+死亡不继承)

## 当前状态（全部已验证通过）
1. 协议级模拟 simulate/bots.mjs：SIM RESULT: PASS（exit 0）——5机器人建房→车卡→自动开局→
   隐藏目标下发→6章通关→公开目标胜利→断线重连→游戏中踢人→结算→返回房间→解散，9断言全过
2. 浏览器级 e2e simulate/e2e.mjs：PASS——5个真实Chromium页面完整通关，截图存 e2e-shots/；
   画面比例修复后重跑：5页面到达终章、公开目标胜利/击败BOSS/章节全覆盖/画布渲染正常，浏览器错误0；
   BetaTest批次回归：sim PASS / e2e PASS / ui-check 20/20 / security 18/18 / canvas-probe 1.000 / solo-probe 单人全程通关
3. 车卡专项UI自动化 tools/ui-check.mjs：10/10（加点下限/加成明细/双槽独立/LLM随机背景/保存toast）
4. 画布渲染实测 tools/canvas-probe.mjs：三视口(1600×900/2560×1080/1366×768) stretchX/Y=1.000、内容比例1.47/2.15/2.26（B-8/B-9修复验证）
5. 安全测试 tools/security-test.mjs：18/18（路径穿越×8/跨站×3/令牌冒用×3/快照泄漏×2/限流×1）
6. LLM 实测 tools/llm-test.mjs：DeepSeek 普通对话985ms、JSON模式1120ms 均正常；
   在线模式下隐藏目标生成/背景随机/结算评价全程真实调用正常
7. 用户已填写 config.json 的 DeepSeek API Key（被 .gitignore 排除，绝不外发/勿回显）
8. 体验优化批次16项（B-1~B-7/R-1~R-9/T-1）全部完成并回归通过，详情见 BACKLOG.md
9. 画面比例修复批次（B-8/B-9）：缓冲/CSS尺寸同步+多人同屏布局修复，三视口实测与双路回归通过，详情见 BACKLOG.md
10. BetaTest批次（B-10~B-13/R-10~R-18 共13项）全部完成：单人完整通关（3分钟/488动作）、
   ui-check 20/20、iter9-probe/ruling-smoke/solo-probe 全 PASS，详情见 BACKLOG.md
11. 遗漏批次（R-19~R-23 共5项）全部完成：auth-test 11/11、ui-check 21/21、layout-probe 7视口×7断言 PASS、
    solo-probe 单人全程通关（架构迁移后复验）、canvas-probe 三视口1.000，详情见 BACKLOG.md
12. UI反馈批次（F-1~F-3）全部完成：stale-token-check PASS、ui-check 26/26（登录全闭环）、
    layout-probe 49断言 PASS、e2e PASS，详情见 BACKLOG.md
13. 用户实测反馈批次（F-4~F-11 共9项）全部完成：manual-mode-probe PASS、applyLook像素级单测通过、
    solo-probe 单人全程通关、ui-check 26/26、layout-probe 49断言、sim/e2e PASS，详情见 BACKLOG.md
14. 冒险内待优化批次（F-12~F-16 共5项）全部完成：map-render-check PASS（非暗像素100%）、
    solo-probe 单人全程通关、ui-check 26/26、layout-probe 49断言、sim/e2e PASS，详情见 BACKLOG.md
15. 20260822游戏体验待优化批次（F-18~F-32 共15项）全部完成：
    - 大厅：F-18 藏书室与账号绑定（未登录为空，按账号分桶存储）/ F-19 在线人数卡片（Unique IP实时统计+5秒大厅广播）
    - 车卡：F-20 载入已保存角色自动同步房间可开局 / F-21 外观预览优化（职业头饰不再遮发色+剪影描边+色板对比度）/
      F-22 AI DM开局前按人数等级调校怪物数值（规则书约束+钳制+离线公式）
    - 游戏内：F-23 玩家/团队状态机（states.mjs）/ F-24 事件树+竖状区域（回合数+头像+点击看战斗事件树）/
      F-25 先攻规则（首战玩家先动/阵营敏捷比较/突袭）/ F-26 怪物NPC名称+血条+蓝条 / F-27 手动回合按钮确认结束 /
      F-28 手动模式隐藏快捷键提示 / F-29 视野三色暴露状态机（stealth.mjs）/ F-30 BOSS表决开战+逃跑回营地+营地界面（camp.mjs）/
      F-31 冒险态怪物随机游荡 / F-32 跨章难度调整+NPC对话变体（tuning.mjs+npc-variants.mjs）
    验证：ui-check 33/33、tuning-probe、stealth-probe、manual-mode-probe（F-27/F-28）、solo-probe 单人通关、
    map-render-check 100%、canvas-probe 三视口1.000、layout-probe、auth/security/ruling/stale/iter9 全部 PASS、sim/e2e PASS
16. 20260822新增功能待优化批次（F-33~F-37 共5项）全部完成（按《游戏系统设计指南》标注系统归属+设计层次）：
    - F-33 视野/游荡/出生点（P0·视野察觉系统+地图与移动系统·范围层+结构层）：怪物视野 8→6（狼/蜘蛛8、僵尸4）；
      游荡锚点限界6格+未暴露怪物不进入玩家视野（开局与手动模式不再被逼战）；出生点安全筛选
      （距BOSS≥17/距怪物≥视野+2）+地图数据修订（6处出生点/怪物移位）+补刷怪物远离出生区；
      新增 tools/spawn-safety.mjs（全章节出生点校验+每章开局=冒险中）
    - F-34 隐藏目标生成提速（P0·AI主持系统·结构层）：难度调校/对话变体后台并行不阻塞开局，
      离线公式同步兜底立即生效，LLM超时收紧（15s/12s/20s/15s）——实测开局等待 1min→1.2s
    - F-35 外观预览清晰度（P1·车卡系统·表现层）：画布160×180（10倍）与CSS 1:1（杜绝非整数缩放模糊）+
      亮色画室背景+纯黑轮廓强化（ui-check断言角像素亮度/尺寸）
    - F-36 行动按钮可用性（P1·战斗系统·交互层）：武器/法术按钮按「射程内有无敌人+资源」实时置灰，
      按钮与title直接标注「·N格」射程
    - F-37 战斗叙述丰富化（P1·AI主持系统·表现层）：旁白变体轮换（不再随机重复）+defaultVoice语料池扩充；
      开战/暴击/BOSS倒下/冒险者倒地/胜负触发LLM按人设加戏（8秒节流）；每回合开始人设旁白；
      新增 tools/narrator-probe.mjs
    验证：ui-check 40/40、manual-mode-probe（F-33开局冒险中+16.5秒不被逼战）、stealth-probe（首个playing快照=冒险中）、
    spawn-safety、narrator-probe、iter9（改为主动接敌）、tuning-probe、solo/sim/e2e 全 PASS

## 常用命令
npm start            # 启动游戏 http://localhost:3000（多开浏览器联机）
npm run sim          # 协议级全流程模拟（约10分钟）
npm run e2e          # 浏览器级全流程模拟+截图
node tools/ui-check.mjs         # 车卡界面专项UI自动化（20项）
node tools/solo-probe.mjs        # 单人体验（B-10确认框 + B-11单人完整通关）
node tools/iter9-probe.mjs       # 迭代9（快捷键权限/聊天/行动顺序）
node tools/ruling-smoke.mjs      # R-17 裁定日志与房主可见性
node tools/auth-test.mjs         # 账户系统（注册/登录/单点登录挤掉/令牌重连）
node tools/layout-probe.mjs      # 多分辨率布局（7视口无溢出+关键元素可见）
node tools/stale-token-check.mjs # 脏存储回归（带失效令牌访问不白屏+自动清令牌）
node tools/manual-mode-probe.mjs # 手动/自动模式行为验证（徽章+角色是否自动行动+F-27回合不自动结束+F-28提示隐藏+F-33开局冒险中不被逼战）
node tools/map-render-check.mjs   # 地图渲染回归（瓦片铺满画布，非暗像素>50%）
node tools/tuning-probe.mjs       # 20260822批次：AI DM难度调校公式/钳制/快照参数/NPC对话变体（F-22/F-32）
node tools/stealth-probe.mjs      # 20260822批次：视野暴露状态机/怪物游荡/BOSS表决/营地/事件树/先攻（F-23~F-31）+开局=冒险中（F-33）
node tools/spawn-safety.mjs       # 待优化批次：全章节出生点安全校验+每章开局=冒险中且无战斗（F-33）
node tools/narrator-probe.mjs     # 待优化批次：旁白变体轮换/人设语料齐备/兜底语料池（F-37）
node tools/security-test.mjs    # 安全回归（18项）
node tools/llm-test.mjs         # DeepSeek连通性
node tools/validate-map.mjs     # 地图可达性校验
node tools/extract-pdf.mjs      # 规则书PDF→data/rules/*.txt（已提取过）
环境变量：DND_PORT/DND_SEED/DND_LLM_BASE_URL/DND_LLM_KEY/DND_LLM_MODEL/DND_OFFLINE=1/DND_DEBUG=1

## 技术栈
Node v23 + 依赖仅 ws/pdfjs-dist（dev: playwright，Chromium已下载）。纯ES模块，无构建步骤。
客户端 vanilla JS + Canvas 程序化像素渲染（无图片资源）。

## 目录结构（速查）
docs/llm_session/
  SESSION_SUMMARY.md 本文件（状态速查）；DEVELOPMENT_LOG.md 完整开发过程与踩坑；BACKLOG.md 迭代看板
server/
  index.mjs           HTTP静态+WS入口；Origin校验/60条秒限流/秘密令牌/路径穿越防护；
                      账户登录/注册(单点登录挤掉旧会话)；s:eval/s:bg/s:log-export点对点回传；DND_DEBUG消息追踪
  accounts.mjs        账户系统：scrypt哈希存data/accounts.json(gitignored)，注册/登录校验，用户名密码规则
  config.mjs          加载config.json+环境变量（config仅服务端）
  llm.mjs            OpenAI兼容chat()，失败返回null由调用方降级
  util.mjs            mulberry32种子随机/roll骰子/findPath(全图BFS+预算截断+目标被占退邻格)/losClear
  dm/personas.mjs    12位DM人设（id: aldric/pip/morgrave/vald/seraphine/viktor/augustus/liliana/gloop/terra/nexa/eiryn）
                      各含 systemPrompt(LLM) 与 voice 模板(离线旁白)
  dm/director.mjs    AI DM导演：intro/assignGoals(LLM生成含无PVP硬性规则,离线模板降级)/
                      judgeClaim(LLM裁定)/flourish加戏/chatOnce/tuneAdventure+tuneChapter(F-22/F-32难度调校)/
                      npcTextVariants(F-32对话变体)；含提示词注入防护INJECTION_GUARD
  dm/narrator.mjs    离线旁白模板渲染
  dm/npc-variants.mjs NPC对话离线变体（F-32）：8位NPC备用文案，线索/奖励/价格不变仅换措辞
  rules/rulesdb.mjs  5E规则速查（供LLM引用）
  game/rooms.mjs     房间状态机 prepare→intro→playing→ended；room.mode(auto/manual)战斗模式；
                      踢人(victimPid通知)/离开/返回；randomBackground(LLM背景,离线降级)；onChange广播；
                      startGame前prepareTuning(F-22)；game:boss-vote/game:camp-*消息分发
  game/game.mjs      编排器：状态容器+系统挂载(installXxx)+快照/广播；回合引擎：先攻(F-25阵营敏捷)/移动/攻击/
                      法术/回合看门狗(F-27手动不自动结束)/TPK/公开+隐藏胜利；事件树actorEvent(F-24)；speed/paused
  game/entities.mjs   实体系统：玩家/怪物/NPC工厂(组件式纯数据)+空间查询(entitiesAt/pathMap/随机落脚点)；
                      怪物含dex/vision/mp/alert/baseHp(F-25/F-26/F-29/F-22)
  game/systems/dialogue.mjs 对话系统：NPC对话树/门/宝箱/出口/篝火互动（F-32：npcTextOf取对话变体）
  game/systems/progress.mjs  进度系统：升级/短休(进入营地,F-30)/章节目标/出口传送（F-32：切换时按上章表现调校下章）
  game/systems/states.mjs    状态机（F-23）：玩家状态(存活/倒地/战斗中/buff/debuff)+团队状态(adventuring/combat/camp)
  game/systems/stealth.mjs   视野与游荡（F-29/F-31）：怪物视野(calm绿/suspicious橙/exposed红)、察觉vs潜行、
                              冒险态随机游荡、BOSS无限视野发现→全队表决（逃跑50%成功传送回营地）
  game/systems/camp.mjs      营地界面（F-30）：恢复生命(消耗短休)/购买商品(商人50%概率)/回到冒险(位置保留)
  game/systems/tuning.mjs    难度调校（F-22/F-32）：离线公式(等级差/上章表现→HP×0.7~1.3/伤害×0.8~1.2/数量±1)
                              +LLM精调+数值钳制+热应用；章节表现统计chapterPerf
  game/dungeon.mjs   LMoP全部内容：MONSTERS(含dex/vision/mp=5E官方数据)/ITEMS/NPCS(对话树)/DUNGEONS章节(ASCII地图+parseMap)；
                      注意：parseMap必须保留exit/chest定义字段（曾因丢弃字段导致传送失败）；
                      等级曲线：序章后2级/城堡后3级/洞穴后4级；城堡洞穴怪物按4人队(踢人后)调弱
  game/hiddengoals.mjs 18种可机械验证的隐藏目标模板（离线模式，全部为本人完成型，无PVP）
  game/charsheet.mjs 车卡派生（种族职业数据来自public/shared/char-defs.mjs共享）
public/
  index.html/css/style.css 像素风UI（含冒险卡片/日志高亮/预览排版/竖状区域/营地界面/状态chips等新样式）
  js/app.mjs 路由(store)+toast导出+覆盖层清理+藏书室卡片按账号存储(F-18: loadCards/saveCard/deleteCard)；
             js/net.mjs WS客户端(秘密令牌存localStorage自动重连,含s:eval/s:bg)
  js/pixel.mjs     程序化tileset+精灵：RACE_GRIDS 8种族专属造型(精灵尖耳/矮人须/半兽人牙/龙裔角/侏儒帽/
                    半身人小只等)+CLASS_TWEAK职业头饰(F-21:不遮发色行,头盔饰条用饰色)+withShades四层明暗+
                    F-21剪影外侧描边(洪泛只描外轮廓,内部间隙透明)
  js/screens/lobby.mjs   大厅(房间列表/12人设选择/藏书室故事集[F-18账号绑定:未登录为空]/冒险者名册/
                          F-19在线人数卡片=Unique IP)
  js/roster.mjs          冒险者名册localStorage(角色存档/在世·已阵亡状态/死亡标记)
  js/screens/room.mjs    房间+车卡(槽位数组自由加点flexList/边界禁用按钮/加成明细/背景textarea+LLM随机/保存toast/
                          战斗模式分段选择器(房主可切换)/单人准备确认框/读取已保存角色[F-20:载入即同步房间可开局]/
                          F-21场景化预览[渐变天幕+地面阴影]/名册upsert)
  js/screens/game.mjs    游戏主界面(ResizeObserver同步缓冲+目标22列×13行缩放+摄像机钳制/
                         多人同格错开绘制/统一名称牌[名称+血条+蓝条,F-26]/视野圈[绿橙红,F-29]/伤害数字屏幕空间化/
                         竖状区域[回合数+头像+点击看事件树,F-24]/BOSS表决覆盖层+营地界面[篝火围坐,F-30]/
                         倍速选择/暂停键/模式徽章/状态chips[F-23]/背包面板/日志过滤高亮/日志·聊天页签切换/
                         行动顺序条/快捷键(空格暂停·小键盘调速,F-28手动隐藏)/结算冒险卡片自动存档+高光配图/阵亡标记名册)
  shared/char-defs.mjs 种族/职业共享数据；shared/autoplay-policy.mjs 自动游玩策略(setThrottle动态节流+
                        F-30 BOSS表决自动同意+营地恢复/返回)
simulate/  bots.mjs(协议级,含踢人/重连/隐藏目标宣称测试), e2e.mjs(Playwright)
tools/     validate-map/llm-test/security-test/ui-check/canvas-probe/extract-pdf/tuning-probe/stealth-probe + 若干*-smoke.mjs调试脚本(可删)
data/rules/ 规则书提取文本(gitignored)

## 关键设计决策
- 联机协议：WS JSON {t:'hello'|'lobby:*'|'room:*'|'game:*'}；服务器全量快照广播 s:state（含按观看者过滤的私密日志与me.goal）
- 账户系统：注册/登录(scrypt哈希+timingSafeEqual)；单点登录=会话表account→token替换+主动关闭旧连接(s:auth-kicked)；
  建房/加入必须登录；令牌失效显式拒绝并提示重新登录；密码与哈希绝不进日志
- 反馈规则：手动模式操作失败回显{ok:false,msg}(自动模式静默防刷屏)；toast同文案1.5秒去重；错误文案见docs/llm_session/ERRORS.md
- 自查机制：冒险结束自动落盘完整日志data/logs/{码}-{时间}.log(私密条目标注)；房主结算页可导出txt；
  客户端未捕获错误进localStorage环形缓冲(50条)，大厅「本机报错自查」面板查看
- 架构(Hybrid ECS)：实体=纯数据组件式，逻辑按领域拆系统模块(installXxx挂载)，Game只做编排器；
  迁移纪律=逐块搬移零行为变化+每步回归，路线见docs/llm_session/ARCHITECTURE.md
- 捏脸系统：drawSprite入口的通用像素变换层(applyLook)——发型(长发/发髻/短发)/胡须/瞳色/饰色，
  所有种族网格自动受益；车卡可随机完整外观；look随车卡存储/名册/游戏内生效
- 地图绘制：每章内置5色主题(森林/洞穴/城镇/庄园/城堡/熔炉)立即可用；LLM按剧情生成调色板
  异步增强(hex校验+缓存+竞态守卫)；drawTile按主题色派生明暗
- 升级经验：XP_NEED表(120/350/650)+击杀经验全员共享+本章等级上限封顶(曲线不变)；
  结算时自动判定隐藏目标(offlineVerify，宣称按钮已移除)
- 经验继承(F-16)：规则书确认累积制(starter.txt 969-972)；名册存level/xp，结算时在世角色写回；
  车卡继承等级(buildSheet按等级算生命值)；章节等级上限只升不降；死亡角色不继承
- 队伍线索(F-15)：服务端addClue统一入口(钥匙/对话clue字段/章节目标doneHint)+快照clues+侧栏面板
- 手动模式严格回合制(F-17)：怪物回合玩家确认推进(_pendingMonster门控+game:endturn+回车/按钮)；
  战斗在玩家行动中触发保留其回合；自动游玩开关开启时代为推进
- 20260822批次关键决策：
  - F-18 藏书室账号绑定：卡片存localStorage键'dnd_cards:'+账号；未登录loadCards返回[]（大厅提示登录）；
    不迁移旧的无账号数据（防共享电脑跨账号泄漏）
  - F-19 在线人数=服务端Unique IP统计（players带ip字段，注册/重连/访客均记录）+每5秒broadcastLobby；
    **顺带修复历史幽灵bug**：登录时同连接访客条目从未真正删除（旧条件ws.__pid!==pid恒为false），
    大厅广播会向幽灵连接推送大厅快照导致误跳大厅——改按 ws===ghost.ws && !ghost.account 删除
  - F-20 载入已保存角色即视为可开局：roster下拉onchange直接pushSheet同步room:charsheet（与保存共用）；
    服务端setReady的'请先完成车卡'校验自然通过
  - F-21 外观预览：诊断数据说话——发色像素仅占0.3%（职业头饰遮住发色行）、自动描边膨胀到29%。
    修复：CLASS_TWEAK保留发色行+头盔饰条用饰色U；描边改洪泛"只描剪影外轮廓"（内部间隙透明）；
    皮肤色板拉开明度差；预览加渐变天幕+地面阴影
  - F-22/F-32 难度调校纪律：离线公式确定性兜底（等级差→HP×0.7~1.3/伤害×0.8~1.2/数量±1，BOSS只调HP）；
    LLM输出结构校验+数值钳制（越界一律拒绝）；调校日志进冒险日志；章节切换按上章表现（倒地/受伤/休息/击杀）
    先离线立即应用、LLM异步精调热更新；NPC对话变体保持clue/flag/价格/奖励不变仅换措辞（离线8人备用文案+LLM变体）
  - F-23 状态机：states.mjs单独维护（teamState: adventuring/combat/camp；玩家state: combat+buffs/debuffs，
    存活/倒地派生）；buff=祝福术/猎人印记(combatOnly，战斗结束清除)，debuff=倒地/蛛网/击倒
  - F-24 事件树：actorEvent只记战斗事件(回合+施动者+目标)，每名玩家单独维护eventTrees（存于开房玩家=服务端）；
    快照orderStrip（战斗=先攻顺序/冒险=团队敏捷降序）+combatEvents；竖状区域点击头像弹出事件树
  - F-25 先攻：首场战斗玩家先动（队内敏捷降序）；无突袭时比较双方最高敏捷（高者先动、平局团队先动）；
    未被发现(小队全calm)时先手攻击=突袭→团队先动；增援小队插入当前行动者之后
  - F-26 名称牌统一：所有实体名称+血条常驻+蓝条（施法怪mp取自5E官方数据；玩家蓝条=法术位）
  - F-27/F-28 手动模式：在线玩家回合无看门狗（只有按钮/回车确认才进入下一顺位；离线2.5秒跳过防死锁）；
    手动模式隐藏快捷键提示行
  - F-29/F-31 视野与游荡：怪物vision(5E数据8~10格,BOSS=∞)；calm/suspicious/exposed三色状态机；
    察觉d20+10 vs 玩家潜行(10+敏捷+熟练+躲藏5)；失败→橙(朝最后出现方向行动+概率主动发现)；
    游荡计时器1.4秒/格，战斗/营地/表决/结束时停止；视野圈颜色随状态（战斗中恒红）
  - F-30 BOSS与营地：发现BOSS（LOS≤16>最长武器射程15，防远程偷袭跳过表决）→全队表决（全员同意开战；
    逃跑d20≥11成功→全队传送回上一营地[lastCamp=有篝火章节]，失败强制开战；离线玩家视为弃权不阻塞）；
    直接攻击BOSS未表决时同样先弹表决；短休改为进入营地界面（恢复生命消耗短休次数掷生命骰/
    购买商品[商人50%概率]/回到冒险位置保留）；营地期间回合不转移、全体行动冻结
  - 20260822待优化批次关键决策（按《游戏系统设计指南》标注系统归属）：
    - F-33 开局=冒险中：①怪物视野缩小（哥布林/打手/霍布/熊地精/骷髅6、狼/巨蜘蛛8、僵尸4、变形怪/格拉斯塔夫7）；
      ②游荡锚点限界6格+未暴露怪物不进入任何玩家视野（遭遇由玩家移动/主动攻击触发——设计上"玩家是遭遇的主动方"）；
      ③出生点安全筛选（距BOSS≥17=表决半径16+1、距怪物≥视野+2）+全章节地图数据修订（出生点/怪物移位）+
      补刷怪物远离出生区≥8格。spawn-safety.mjs 双重校验（原始数据+引擎级每章开局）
    - F-34 开局等待链：prepareTuning 同步套离线公式→立即放行；LLM调校+对话变体 Promise.all 并行异步热应用；
      tuneAdventure 15s/npcTextVariants 20s/目标生成 15s 超时兜底——实测在线模式开局 1min→1.2s
    - F-35 预览1:1：画布内部160×180（10倍）与CSS固定160×180一致（非整数缩放=模糊的根因）；
      亮色径向渐变"画室"背景+纯黑轮廓（pal.o=#14101e）提升脸/头发轮廓对比
    - F-36 按钮可用性=实时可用性：武器/目标型法术按「射程内有无敌人+LOS」置灰、资源不足置灰，
      label与title直接标注「·N格（近战）」；治疗可自疗不置灰
    - F-37 叙述：offlineNarrate增加idx轮换参数（Director.narrate计数轮换，不再随机重复）；
      defaultVoice语料池3条起；开战/暴击/BOSS倒下/倒地/胜负→flourish按事件引导词+人设systemPrompt生成
      （8秒节流、结局force）；每回合开始 narrate('roundStart')
    - 自动策略风筝化：远程/施法角色射程内可命中则不贴脸（canHitFromHere=武器或法术在射程+LOS），
      显著提升机器人团队在城堡/洞穴等硬仗的生存率
- 瓦片坐标契约：drawTile入参为格子索引，内部translate(x*TILE,y*TILE)；纹理哈希保留原索引（曾因索引当像素绘制致地图全黑）
- 点对点回传：game:eval→s:eval、room:bg-random→s:bg、踢人→s:kicked+大厅快照、离开→s:state
- 秘密令牌：新玩家获得 tk_随机令牌（仅s:hello下发，快照不含）；重连/改名凭令牌恢复同pid；伪造pid无效
- 回合：战斗=先攻顺序(击杀即从order移除)；非战斗=座位顺序；怪物回合450ms/speed定时器，暂停时重新排队
- 移动：客户端BFS发目标点，服务端findPath按剩余移动力走
- 剧情钥匙(cage_key/castle_key)为队伍共有(game.keys)；NPC对话选项含need/once/cost/tag
- 章节出口需need flag；自动游玩策略优先未访问章节(防庄园循环)、优先解救类对话选项(防西达尔死循环)、
  治疗优先最低血量含倒地、集火低血量敌人、温和节流+独立节拍器兜底(防快照驱动死锁)
- 战斗模式：房主建房时设定(auto默认/manual)，车卡阶段房主可随时切换(room:mode)；自动战斗可倍速(0.5~4x,联动服务端怪物延迟+
  客户端节拍器+策略节流)与暂停(冻结怪物计时器)；调速/暂停仅房主(服务端强制+客户端禁用/toast)；快捷键：
  空格=暂停/继续、小键盘←/→=减速/加速（非房主空格=结束回合），顶栏有友好提示行
- 单人平衡(B-11)：队伍<4人时怪物数量max(1,round(count*N/4))不超原值、怪物HP×(0.5+0.5*N/4)、单人开局药水3瓶；
  单人准备不自动开局，弹确认框(立即开始/继续等待)；4/5人队数值不变(不动点)
- 玩家聊天(R-18)：game:say→kind=chat；右下角面板日志/聊天页签切换；行动顺序条(R-16)展示回合数与先攻顺序，
  点击头像以unitFilter过滤查看该单位行动记录
- DM裁定可验证(R-17)：judgeClaim注入5E规则速查(唯一依据、禁止编造)，裁定写入ruling日志(注明规则依据)、仅房主可见
- 冒险者名册(R-11)：localStorage(dnd_roster)，保存车卡自动收入；阵亡标记永久(死亡禁战)；大厅展示状态
- 冒险卡片：结算时客户端请求game:eval→服务端按stats加权评分(S~D)+LLM一句话评价(模板降级)→
  客户端组装卡片(剧本/DM/角色/结局/时长/高光时刻)自动存入localStorage(dnd_cards上限50)→大厅故事集面板
- 隐藏目标：LLM生成含硬性规则"领取人=本人、对象=NPC/怪物/BOSS、禁止涉及其他玩家(无PVP)"；离线模板全部合规；
  B-12称谓约束：LLM提示词注入剧本NPC/BOSS名单并要求用真实名称(禁模糊称号)，离线模板名称自解释(如「苦修者·不眠不休」)
- 音效无音频设备时自动静默；摄像机变换必须带Y偏移；画布缓冲与CSS严格同步（ResizeObserver+RAF+全链height:100%）防拉伸变形

## 踩过的坑（防复发，详见 DEVELOPMENT_LOG.md）
1. 绝不可按进程名批量杀node——曾误杀宿主；清理按端口归属PID
2. parseMap曾丢exit/chest定义字段→用展开语法保留
3. findPath旧版贪心在墙后永远空路径→全图BFS+预算截断
4. 房间phase曾卡intro(条件写反)→踢人失效；intro后无条件置playing
5. 踢人通知曾发给房主→返回victimPid单独通知
6. 节流依赖快照触发曾死锁→独立节拍器兜底
7. 购买cost语义错误/情报优先不选解救→对话循环；已修语义+解救最高优先
8. 覆盖层重复叠加挡点击→先清理再重建
9. e2e错误无限收集OOM→去重上限50条
10. 车卡三连bug同源(单键flex对象)→槽位数组模型+边界禁用按钮+加成明细
11. 测试脚本踩到新特性(禁用按钮重试超时)→循环内判断isEnabled
12. 节奏参数只改一端会"假快"→速度/暂停必须服务端计时器+客户端循环双端同步
13. 结算功能依赖埋点→stats埋点在引擎层做一次，上层免费复用
14. 画布垂直拉伸2.2~2.5倍（人物细长条）=缓冲与CSS不一致（min-height测错+一次性resize+高度链断裂）→ResizeObserver+RAF+全链height:100%；渲染问题必须实测定位（canvas-probe）而非猜测
15. 断言时机竞态：自动策略秒杀怪物后采样→误报；断言必须锚定首个事件快照
16. DOM顺序脆弱：新增UI区块挪动.cg-section索引→测试与代码都用语义选择器(.opt-grid)
17. 权限必须双端强制：服务端hostId校验(唯一真相)+客户端禁用/toast(体验层)
18. LLM输出长度不可控→长度守卫(去空白≥140字)否则降级离线模板(6条≥150字)
19. 高光配图零资源方案：程序化合成像素画(dataURL入卡片)
20. 数值缩放以满编队为不动点：只向小队伍收缩(数量round(count*N/4)、HP×(0.5+0.5*N/4))
21. 会话替换三步闭环：通知旧端(s:auth-kicked)→关闭旧连接→删除旧记录，缺一步出幽灵会话
22. 测试死锁：connect()等首条消息但hello在connect后发送→改为open即resolve
23. 宿主输出采集偶发故障→测试自写日志文件+看门狗，不依赖捕获
24. 操作失败回显要区分人/机器上下文：manual回显、auto静默
25. 重构最大敌人是"一次改太多"→挂载器迁移法(installXxx)逐系统独立回归
26. 拒绝路径也要保证客户端能渲染：令牌失效必须下发访客快照，否则整页空白（自动化用干净存储覆盖不到，需专门的脏存储复现测试）
27. UI初始渲染不能依赖异步数据到达（挂载即渲染）；状态判断选对锚点（访客也有pid，认证分流用!account）
28. 视觉问题先数值测量再改：getBoundingClientRect诊断（gap=0px/卡片50px/吸顶失效根因），改后必须复测
29. 初始化标志要基于"是否已初始化"而非外部状态推断（firstGame恒假→模式从未初始化→手动模式乱自动战斗）
30. sticky吸顶选对对象：单元素受父列高度限制→整列吸顶(align-self:start)才能覆盖整页滚动
31. 程序化像素通用变换先做锚点净化（眼行侧发像素污染头发行锚点→按≥3发色像素过滤），长发允许向轮廓外生长
32. AI生成必须"离线立即可用+在线异步增强"：地图主题=内置色板+LLM调色板降级
33. 展示型需求要校准机制：升级经验加XP_NEED表+章节上限封顶，数字与机制一致不撒谎
34. 删交互入口要留替代路径：宣称按钮移除→结算自动判定
35. 渲染断言要看"内容分布"而非"有没有内容"：瓦片堆叠左上角的假内容骗过了canvas-probe/e2e——map-render-check断言非暗像素占比>50%
36. 坐标契约统一单位并写注释：drawTile入参=格子索引（曾因索引当像素绘制，地图自MVP起全黑）
37. 任何依赖布局结果的滚动/测量必须在元素挂载之后（scrollTop先赋值→scrollHeight=0→日志停在顶部）
38. 规则争议先引规则书原文：经验继承依据starter.txt 969-972"经验随持续冒险累积"
39. 新广播源会让沉睡的幽灵bug复活：F-19加5秒大厅广播后，车卡界面2~3秒被踢回大厅——根因是历史遗留的
    "登录时清理同连接访客"条件(ws.__pid!==pid)恒为false、幽灵条目从未删除，广播向幽灵连接的同一ws推大厅快照。
    教训：**加任何周期广播前先审计注册表是否存在僵尸条目**；幽灵清理条件要按对象身份(ws===ghost.ws&&!account)判断
40. 视野/暴露系统会改变所有战斗触发路径：旧的"攻击触发战斗"测试被新规则反噬（攻击秒杀唯一怪物→无敌方回合）；
    测试要改走"怪物视野察觉触发战斗"（玩家不攻击），保证被测对象存活
41. BOSS表决必须先于一切攻击路径：仅靠"发现即表决"(vision check)不够——战斗进行中长弓15格可直射未表决BOSS；
    解决：actAttack对BOSS一律先_openBossVote（战斗中已入战的小队除外），且发现半径16>最长武器射程15
42. 调校公式要与真实等级曲线对齐：序章loadChapter即自动升到Lv2（上限2），故序章调校恒为×1.0不动点；
    断言"Lv1→×0.9"必须手工拉回等级或用城堡章(上限3)验证——测试数据要与机制时序一致
43. 视觉修复先测色块占比再动手：预览"不同颜色无区别"的真相=发色像素仅占0.3%（职业头饰3行w/d/h遮住发色行）+描边占29%；
    像素级统计(ImageData直方图)替代读图，改动后再测发色占比提升8倍为证
44. "开局即遭遇"的元凶是补刷怪物：序章固定怪物离出生点其实≥7格，逼战的是 count 补充逻辑把怪物随机刷在
    出生点旁边——补刷/热补刷必须带"远离玩家"距离约束，与出生点安全筛选成双保险
45. 旧探针被动等战斗会被新设计反噬：iter9 之前靠"怪物视野自动开战"推进；F-33 让开局保持冒险中后，
    探针必须主动驱动玩家接敌——设计变更时要审计所有依赖旧触发路径的测试
46. 引号内索引偏移坑：手改 ASCII 地图行时索引极易错位（带引号的行字符串偏移+1、同行多次交换顺序依赖），
    用"脚本索引级替换+parseMap复验"代替手数，替换目标格必须校验为可行走地板
47. 风筝策略是机器人团队的生存刚需：远程/施法机器人贴脸输出会把全队拖进硬仗——"射程内可命中就不移动"
    的 canHitFromHere 规则（武器或法术均计入）显著提升城堡/洞穴生存率

## 安全基线（已实现并有测试覆盖）
config.json gitignored不进入云端；public/零密钥引用；静态目录穿越全404；WS Origin校验(恶意源close 1008)；
60条/秒限流；秘密令牌防冒用；隐藏目标与裁定仅本人可见；LLM提示词注入防护(INJECTION_GUARD)。

## 未完成/可选方向（无强制项）
- 更多副本/道具/法术扩展；隐藏胜利路径的端到端完整验证(目前仅验证公开目标路径+宣称机制)
- 冒险卡片的社会化功能：成就系统、卡片互相分享、道具交易（卡片数据模型已预留）
- 大厅与房间窄屏布局、音效音量控制等体验优化
- 手动战斗模式的深度体验（技能选择面板、范围法术指引等）；隐藏胜利路径的端到端完整验证
