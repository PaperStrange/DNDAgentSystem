# tools · 脚本分类索引

> 目的：`tools/` 脚本过多、用途混杂，本索引按**用途**分类，标明每个脚本的类别、是否属于 SOP 验证基线、以及执行约束。
> 编制：2026-09-15（R1-7 工具分类管理）｜上位依据：`docs/pm/knowledge/sop-1.14-readable.md:163-172`（SOP-F 验证基线）
> 分类原则：**只登记、不改变文件位置**——移动会破坏 `package.json` scripts 与各脚本内的相对引用，如需物理归目录须单独立卡并同步引用。

## 分类总览

| 类别 | 数量 | 说明 |
|---|---|---|
| A SOP 必跑验证基线 | 6（另 2 项在 `simulate/`） | 每次迭代必须全过 |
| B 浏览器探针（Playwright） | 8 | 需 Chromium，写截图 |
| C 服务端 / 协议探针 | 14 | 协议级，启服或直连 |
| D 一次性采样与生成 | 5 | 历史产物，非回归用 |
| E 构建 / 打包 | 2 | 图标、Android |
| F CI 门禁与校验 | 4 | 门禁前置 |
| G 文档工具 | 1 | SOP 图转换 |

> 一个脚本可同时属于 B/C（探针类）与 A（被选入基线），下表「SOP 基线」列单独标注。

## A · SOP 必跑验证基线（8 项）

来源：`sop-1.14-readable.md:163-172`。**每次迭代必须全过**，结果须记真实退出码。

| 脚本 | 位置 | 说明 |
|---|---|---|
| `bots.mjs` | `../simulate/` | 协议级全流程（`npm run sim`） |
| `e2e.mjs` | `../simulate/` | 浏览器级全流程（`npm run e2e`） |
| `ui-check.mjs` | tools | UI 专项（车卡） |
| `solo-probe.mjs` | tools | 单人体验（B-10/B-11） |
| `canvas-probe.mjs` | tools | 画布渲染三视口 |
| `layout-probe.mjs` | tools | 多视口布局 |
| `auth-test.mjs` | tools | 账户系统 |
| `security-test.mjs` | tools | 安全测试（**被 .gitignore 排除**，用户已裁定属正常现象，无需管理） |

> 隔离运行统一走 `docs/qa/restart-sprint1/run-baseline.mjs`（沙箱 + 目录联接 + `DND_DATA_DIR` + 强制离线）。
> 注意：`node --test` **传目录会 MODULE_NOT_FOUND**，须传具体文件路径。

## B · 浏览器探针（Playwright，会写截图）

| 脚本 | 用途 | 同时属 A |
|---|---|---|
| `ui-check.mjs` | 车卡 UI 自动化 | ✅ |
| `chargen-probe.mjs` | 车卡流程探针 | |
| `map-render-check.mjs` | 地图渲染检查（非暗像素占比，防"地图全黑"回归） | |
| `canvas-probe.mjs` | 画布三视口 | ✅ |
| `layout-probe.mjs` | 多视口布局 | ✅ |
| `manual-mode-probe.mjs` | 手动模式探针 | |
| `stale-token-check.mjs` | 失效令牌 / 脏存储 | |
| `sw-cache-probe.mjs` | Service Worker 缓存 | |
| `e2e.mjs` | 全流程（在 `simulate/`） | ✅ |

## C · 服务端 / 协议探针

| 脚本 | 用途 | 同时属 A |
|---|---|---|
| `solo-probe.mjs` | 单人体验 | ✅ |
| `stealth-probe.mjs` | 潜行 / 视野（F-23~F-31） | |
| `spawn-safety.mjs` | 出生点安全（F-33） | |
| `tuning-probe.mjs` | 难度调校（F-22/32） | |
| `iter9-probe.mjs` | R-15/16/18 专项 | |
| `narrator-probe.mjs` | 旁白（F-37） | |
| `game-smoke.mjs` | 冒烟（SOP-D 自验基线之一） | |
| `travel-smoke.mjs` | 章节传送冒烟 | |
| `stuck-smoke.mjs` | 卡死检测 | |
| `town-fight-smoke.mjs` | 城镇战斗冒烟 | |
| `ruling-smoke.mjs` | 裁定冒烟（R-17） | |
| `ws-probe.mjs` | WebSocket 连通性 | |
| `s1-5-log-check.mjs` | 日志密度检查 | |
| `s1-4-flourish-check.mjs` | 加戏检查 | |
| `auth-test.mjs` | 账户系统 | ✅ |

## D · 一次性采样与生成（非回归用，勿纳入基线）

| 脚本 | 说明 |
|---|---|
| `extract-pdf.mjs` | 从规则书 PDF 提取文本 → `data/rules/` |
| `s1-4-sample-gen.mjs` | S1-4 样本生成 |
| `s2-3-before-after-samples.mjs` | 前后对比样本 |
| `s2-3-narration-metrics.mjs` | 旁白指标统计 |
| `s2-3-online-flourish-sample.mjs` | 在线加戏样本 |

## E · 构建 / 打包

| 脚本 | 说明 |
|---|---|
| `gen-app-icons.mjs` | 生成应用图标 |
| `build-android.mjs` | Android 打包 |

## F · CI 门禁与校验

| 脚本 | 说明 |
|---|---|
| `ci-gate/compliance-check.mjs` | 红线合规门禁（S2-6），删除审计关卡 |
| `ci-gate/selftest.mjs` | 门禁自检 |
| `validate-map.mjs` | 地图可达性校验 |
| `llm-test.mjs` | LLM 连通性诊断（**被 .gitignore 排除**，属正常现象） |
| `run-tests.mjs` | **测试聚合入口**（`npm test`）：发现 `tests/**/*.test.mjs` 并以显式文件路径交给 `node --test`。背景：`node --test <目录>` 在 Windows 会 MODULE_NOT_FOUND。安全约束见文件头（无 shell、防路径穿越、无写操作） |

## G · 文档工具

| 脚本 | 说明 |
|---|---|
| `mermaid-validate/sop-mermaid-convert.mjs` | SOP 流程图转换与校验 |

## 遗留待办

- 顶层有两个残留日志 `_auth_out.log`、`_ui_out.log`（一次性输出，非脚本产物），是否清理待定（红线-9：须先列举确认、逐个处理）。
- 物理归子目录（如 `tools/baseline/`、`tools/probe/`）需单独立卡：会牵动 `package.json` scripts 与脚本内相对引用，须同步修改并回归。
