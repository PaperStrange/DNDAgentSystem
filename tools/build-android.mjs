// S3-1 Android APK 构建脚本：自动定位本地工具链（.toolchain/）并产出可安装 APK 到 dist/android/
// 用法：npm run android:apk   （或 node tools/build-android.mjs [--release]）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tc = join(root, '.toolchain');
const release = process.argv.includes('--release');

function findDir(base, pred) {
  if (!existsSync(base)) return null;
  const hit = readdirSync(base).find(n => pred(n) && statSync(join(base, n)).isDirectory());
  return hit ? join(base, hit) : null;
}
const jdkHome = process.env.JAVA_HOME || findDir(join(tc, 'jdk'), n => n.startsWith('jdk'));
const sdkHome = process.env.ANDROID_HOME || (existsSync(join(tc, 'android-sdk')) ? join(tc, 'android-sdk') : null);

if (!jdkHome || !existsSync(join(jdkHome, 'bin', 'java.exe'))) {
  console.error('❌ 未找到 JDK。请设置 JAVA_HOME，或把 JDK 解压到 .toolchain/jdk/<jdk-17.x>');
  process.exit(1);
}
if (!sdkHome || !existsSync(join(sdkHome, 'platform-tools'))) {
  console.error('❌ 未找到 Android SDK。请设置 ANDROID_HOME，或用 sdkmanager 安装到 .toolchain/android-sdk');
  process.exit(1);
}

// 原生工程与配置统一放在 release/ 下（release/capacitor.config.json + release/android）
const shellDir = join(root, 'release');
const androidDir = join(shellDir, 'android');

// 先同步 Web 资源到原生工程（public → release/android/app/src/main/assets/public）
console.log('▶ cap sync android …');
const sync = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android'], { cwd: shellDir, stdio: 'inherit', shell: true });
if (sync.status !== 0) { console.error('❌ cap sync 失败'); process.exit(sync.status || 1); }

// 让 AGP 稳定找到 SDK（不依赖 shell 环境变量）
const localProps = join(androidDir, 'local.properties');
if (sdkHome) {
  writeFileSync(localProps, 'sdk.dir=' + sdkHome.replace(/\\/g, '\\\\') + '\n', 'utf8');
}

// 优先使用 .toolchain 里已下载的 Gradle 发行包，避免 gradlew 去 services.gradle.org 拉 130MB（国内极慢）
const localGradle = findDir(join(root, '.toolchain', 'gradle'), n => n.startsWith('gradle-'));
const gradleBin = localGradle
  ? join(localGradle, 'bin', process.platform === 'win32' ? 'gradle.bat' : 'gradle')
  : join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const task = release ? 'assembleRelease' : 'assembleDebug';
console.log('▶ ' + (localGradle ? 'gradle（本地 .toolchain）' : 'gradlew（将下载 Gradle 发行包，约 130MB）') + ' ' + task + ' …');
const r = spawnSync(process.platform === 'win32' ? '"' + gradleBin + '"' : gradleBin, [task, '--no-daemon'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, JAVA_HOME: jdkHome, ANDROID_HOME: sdkHome, ANDROID_SDK_ROOT: sdkHome },
});
if (r.status !== 0) { console.error('❌ Gradle 构建失败，退出码 ' + r.status); process.exit(r.status || 1); }

// 收集产物（统一放到项目根的 release/，不再散落到 dist/ 各平台子目录）
const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });
const apkDir = join(androidDir, 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug');
if (!existsSync(apkDir)) { console.error('❌ 未找到 APK 输出目录: ' + apkDir); process.exit(1); }
const apks = readdirSync(apkDir).filter(f => f.endsWith('.apk'));
for (const a of apks) {
  const dest = join(outDir, 'DiceAndCampfire-' + (release ? 'release' : 'debug') + '.apk');
  copyFileSync(join(apkDir, a), dest);
  const mb = (statSync(dest).size / 1048576).toFixed(1);
  console.log('✅ 已产出：' + dest + '（' + mb + ' MB）');
}
console.log('📦 安装：adb install -r "' + join(outDir, 'DiceAndCampfire-' + (release ? 'release' : 'debug') + '.apk') + '"');
