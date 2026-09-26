# 打包与安装指南（iOS / Android / Windows 桌面）

> S3-1 打包批次：把《骰与篝火》（Node + WebSocket + Canvas 的联机跑团游戏）打包为三个平台的可测试产物。
> 生成时间与产物路径见文末「本地产物清单」。构建脚本均可重复执行。

## 0. 先理解一件事：这游戏需要一个「服务器」

游戏逻辑（AI DM、回合引擎、地图与战斗）跑在**房主电脑**的 Node 进程里，手机/桌面端都是客户端：
浏览器壳、Android APK、iOS App、Windows 桌面版都会连接这台服务器（局域网 `ws://<电脑IP>:3000/ws`）。

因此三种形态：

| 形态 | 需要电脑开服务器吗 | 适用 |
|---|---|---|
| **PWA / 浏览器** | 需要（`npm start`） | 最快验证；iPhone 免 Mac 也能用 |
| **Android APK** | 需要（同一 Wi-Fi） | 安卓手机/平板安装即用 |
| **Windows 桌面版** | **不需要**（服务器内嵌在 exe 里） | 电脑上双击即玩，也可当房主给手机联机 |
| **iOS App（Xcode 工程）** | 需要 | 需在 Mac 上用 Xcode 编译，见第 4 节 |

---

## 1. Windows 桌面版（本机可直接测试）

**产物**：`dist/windows/`

- `DiceAndCampfire-1.0.0-portable.exe` —— 免安装单文件，双击即玩（内嵌游戏服务器，自动选空闲端口）
- `DiceAndCampfire-1.0.0-win-x64.zip` —— 解压后运行 `骰与篝火.exe`
- 解包目录（`win-unpacked/`）—— 直接运行其中的可执行文件

**特性**
- 内嵌服务器：无需另外 `npm start`，窗口标题会显示本机地址，例如
  `骰与篝火 · 本机 http://127.0.0.1:52341/ · 局域网 http://192.168.1.5:52341`
- 局域网联机：把标题栏里的 `http://192.168.x.x:<端口>` 发给队友，手机浏览器/客户端连这个地址即可
- 菜单：`游戏 → 重新加载 / 重新开始（清空本地登录态） / 退出`；`查看 → 全屏(F11) / 开发者工具(F12)`
- 数据目录：`%APPDATA%\骰与篝火\data`（账户库 `accounts.json`、冒险日志 `logs/`、用户 `config.json`）
  菜单 `帮助 → 数据目录` 可直接打开

**重新构建**
```powershell
npm run icons          # 生成 build/icon.png（应用图标）
npm run desktop:build  # electron-builder → dist/windows/
npm run desktop:smoke  # 无界面自检：启动内嵌服务器+加载页面，输出 DESKTOP SMOKE: PASS
npm run desktop        # 直接以开发模式运行桌面版
```

> **国内网络注意**：Electron 二进制与 electron-builder 依赖包默认从 GitHub Releases 下载，本机实测**下载不动**。
> 已改用 npmmirror 镜像，重建时先设置：
> ```powershell
> $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
> $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
> npm run desktop:build
> ```
> 若卡在 `winCodeSign` 解压失败（`Cannot create symbolic link : A required privilege is not held by the client`，
> Windows 非管理员/未开开发者模式时必然出现），把已解压好的目录复制一份即可跳过：
> ```powershell
> $c = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
> Copy-Item "$c\<任一已解压的数字目录>" "$c\winCodeSign-2.6.0" -Recurse
> ```
> （也可在 `electron-builder.json` 里设 `"win": { "signAndEditExecutable": false }` 跳过 rcedit，代价是 exe 失去自定义图标/版本信息。）

---

## 2. Android APK（本机可直接测试）

**产物**：`dist/android/DiceAndCampfire-debug.apk`

**安装**
```powershell
adb install -r "dist\android\DiceAndCampfire-debug.apk"      # 连上手机/模拟器（需先装 platform-tools）
```
或把 APK 拷到手机点击安装（需允许「安装未知来源应用」）。

**首次启动**
1. 电脑先启动服务器：`npm start`（或直接开 Windows 桌面版），记下局域网地址（如 `192.168.1.5:3000`）
2. 手机与电脑连**同一个 Wi-Fi**
3. App 打开后会显示「连接服务器」引导页 → 输入 `192.168.1.5:3000` → 连接
4. 地址会记住；之后可在**大厅右上角「🔌 IP」按钮**里随时切换服务器

> Android 9+ 默认禁止明文 HTTP，APK 已在 `AndroidManifest.xml` 打开 `usesCleartextTraffic`。

**重新构建**
```powershell
npm run android:apk            # = cap sync android + gradle assembleDebug + 拷贝到 dist/android/
node tools/build-android.mjs --release   # 发布版（未签名，需自行配置签名）
```
工具链自动定位：`.toolchain/jdk/<jdk-17.x>`、`.toolchain/android-sdk`、`.toolchain/gradle/<gradle-8.2.1>`
（也可用环境变量 `JAVA_HOME` / `ANDROID_HOME` 覆盖；本机已下载好，不依赖 gradlew 再去国外拉 130MB 发行包）。
`android/gradle/wrapper/gradle-wrapper.properties` 里的 `distributionUrl` 已指向腾讯镜像，Android Studio 里也能直接用。

> 本机实测首次全量构建约 6 分钟（要下 AndroidX/Capacitor 依赖），之后增量构建约 1 分钟。

---

## 3. PWA（iPhone / Android 浏览器即刻可用，免安装包）

1. 电脑 `npm start`，手机浏览器打开 `http://<电脑IP>:3000`
   （也可以带参数直达并记住地址：`http://<电脑IP>:3000/?server=<电脑IP>:3000`）
2. **iOS Safari**：分享 → 「添加到主屏幕」→ 从主屏图标全屏启动（已配置 `apple-mobile-web-app-capable`、图标、状态栏样式）
3. **Android Chrome**：菜单 → 「安装应用 / 添加到主屏幕」
4. 已内置 `manifest.webmanifest` + `sw.js`：应用外壳可离线缓存，联网后连服务器即可游戏

> PWA 是目前**唯一不需要 Mac**就能在 iPhone 上真机测试的形态。

---

## 4. iOS App（Xcode 工程已就绪，需在 Mac 上编译）

Windows 上无法产出 `.ipa`（苹果工具链仅 macOS 提供），因此本仓库交付**可直接打开的 Xcode 工程**：

- `ios/App/App.xcworkspace`（Capacitor 生成的 iOS 工程，Web 资源已同步到 `ios/App/App/public/`）
- `capacitor.config.json`（应用名「骰与篝火」、bundle id `com.dndagent.dicecamp`）

**在 Mac 上构建**
```bash
npm install                 # 若尚未安装依赖
npx cap sync ios            # 同步 Web 资源（改了客户端代码后重跑）
cd ios/App && pod install   # 首次需要 CocoaPods
open App.xcworkspace        # Xcode 打开 → 选真机/模拟器 → Run
# 打包分发：Product → Archive → Distribute App（需开发者账号）
```
- 免费 Apple ID 也可真机调试（7 天有效期）：Xcode → Signing & Capabilities → 选个人 Team
- 模拟器自测：iPhone 模拟器里点 App → 连接引导页填 `127.0.0.1:3000`（模拟器与 Mac 共享网络）
- iOS 默认也禁止明文 HTTP：若连 `http://192.168.x.x:3000` 失败，在 `ios/App/App/Info.plist` 增加
  `NSAppTransportSecurity → NSAllowsArbitraryLoads = true`（仅本地联机测试用）

---

## 5. 三个平台共用的客户端适配（S3-1）

| 适配 | 说明 |
|---|---|
| 服务器地址可配置 | `?server=` → localStorage → 同源；原生壳首启显示连接引导页；大厅可随时切换 |
| 触摸操作 | 点按=原点击逻辑；长按=取消选择；拖动=预览格子；右侧「✕ 取消选择」按钮替代右键 |
| 移动端布局 | ≤820px：画布在上、行动条横排、侧栏在下；大厅/车卡单列；按钮加大；隐藏键盘快捷键提示 |
| PWA | manifest + Service Worker + 图标（192/512/maskable/apple-touch） |
| 数据可写目录 | `DND_DATA_DIR`：打包后账户库/日志/用户配置写到用户目录，不写应用包内部 |

**图标**：`npm run icons` 用游戏像素美术程序化生成（篝火 + d20），输出
`public/icons/*`（PWA）、`build/icon.png`（Windows）、`android/**/mipmap-*/ic_launcher(.round|_foreground).png` + 自适应图标底色（Android）。
Android 8+ 走自适应图标（`mipmap-anydpi-v26`），因此 foreground 与 `values/ic_launcher_background.xml` 必须一起改，否则桌面上仍是 Capacitor 默认图标。

---

## 6. 本地产物清单（已构建并验证）

```
dist/
  android/DiceAndCampfire-debug.apk            11.6 MB  安卓可安装包（debug 签名）
  windows/DiceAndCampfire-1.0.0-portable.exe   89.2 MB  Windows 免安装单文件
  windows/DiceAndCampfire-1.0.0-win-x64.zip   132.9 MB  Windows 解压版（内含 骰与篝火.exe + server/public）
  ios/DiceAndCampfire-ios-project.zip           7.9 MB  iOS Xcode 工程（Mac 上编译）
android/  ios/                                          Capacitor 原生工程（可继续开发）
desktop/main.mjs                                        Electron 桌面版入口（内嵌服务器）
.toolchain/                                             本地 JDK17 + Android SDK + Gradle（gitignore，构建用）
```

**本机验证记录**

| 产物 | 验证方式 | 结果 |
|---|---|---|
| Windows 便携版 / 解压版 | `dist\windows\win-unpacked\骰与篝火.exe --smoke`、`DiceAndCampfire-1.0.0-portable.exe --smoke` | `DESKTOP SMOKE: PASS`，退出码 0（内嵌服务器起在随机空闲端口并加载出游戏页） |
| Android APK | `aapt2 dump badging` + `apksigner verify` + 包内资源比对 | 包名 `com.dndagent.dicecamp`、label「骰与篝火」、minSdk 22 / targetSdk 34、debug 签名有效、
`assets/public/*` 含 `index.html`/`js/app.mjs`/`css/style.css`，`res/mipmap-*` 为自制图标 |
| iOS 工程 zip | `cap sync ios` 后打包，解包核对 | 含 `App/App.xcodeproj/project.pbxproj`、`Info.plist`、`App/App/public/*`（Web 资源已同步） |

> 真机安装/连服务器这一步必须在有设备的环境完成：APK 用 `adb install -r`，iOS 需 Mac + Xcode。


## 7. 已知限制

1. **iOS 真机安装包**需要 Mac + Xcode（或开发者账号）——本机只能交付工程与 PWA 两条路径
2. Android APK 为 **debug 签名**（可直接安装测试）；上架/分发需自行配置 release 签名
3. 联机依赖局域网：跨网段/公网联机需自行做端口映射或用内网穿透（游戏本身按局域网设计，且未加密 WS）
4. AI DM 的在线模式需要房主电脑 `config.json` 里配置 LLM Key；未配置时自动降级离线模板 DM（仍可完整游玩）
