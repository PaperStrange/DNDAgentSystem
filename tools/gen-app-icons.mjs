// S3-1 打包资产：程序化生成应用图标（PWA / Android / iOS / Windows）
// 复刻游戏内像素美术语言：暗紫夜色 + 篝火 + d20 骰子
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

function px(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

// 像素篝火（对齐 public/js/pixel.mjs 的 'f' 瓦片美术）
function drawCampfire(ctx, ox, oy, s) {
  px(ctx, ox, oy + 11 * s, 8 * s, 2 * s, '#5d4328');
  px(ctx, ox - 1 * s, oy + 12 * s, 10 * s, 2 * s, '#5d4328');
  px(ctx, ox + 2 * s, oy + 4 * s, 4 * s, 7 * s, '#e07030');
  px(ctx, ox + 3 * s, oy + 6 * s, 2 * s, 4 * s, '#f0a040');
  px(ctx, ox + 3 * s, oy + 8 * s, 2 * s, 2 * s, '#ffe9a0');
  // 火星
  px(ctx, ox + 5 * s, oy + 1 * s, s, s, '#ffd070');
  px(ctx, ox - 2 * s, oy + 2 * s, s, s, '#e8a040');
}

// 像素 d20（等距菱形+顶面高光+数字点）
function drawD20(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.lineTo(r * 0.92, -r * 0.18); ctx.lineTo(r * 0.58, r);
  ctx.lineTo(-r * 0.58, r); ctx.lineTo(-r * 0.92, -r * 0.18); ctx.closePath();
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, '#f0d070'); g.addColorStop(0.5, '#e8c15a'); g.addColorStop(1, '#b8892f');
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.strokeStyle = '#2a2430'; ctx.stroke();
  // 三角分割线
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.lineTo(0, r * 0.28);
  ctx.moveTo(-r * 0.92, -r * 0.18); ctx.lineTo(r * 0.92, -r * 0.18);
  ctx.moveTo(0, r * 0.28); ctx.lineTo(r * 0.58, r);
  ctx.moveTo(0, r * 0.28); ctx.lineTo(-r * 0.58, r);
  ctx.strokeStyle = 'rgba(42,36,48,.55)'; ctx.lineWidth = Math.max(1, r * 0.04); ctx.stroke();
  // 中央数字 20 的抽象点阵（两横排点）
  ctx.fillStyle = '#2a2430';
  const d = r * 0.12;
  for (const [dx, dy] of [[-0.28, -0.1], [0.06, -0.1], [-0.28, 0.14], [0.06, 0.14], [0.4, 0.02]]) {
    ctx.beginPath(); ctx.arc(dx * r, dy * r, d, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// transparent=true 时只画前景（Android 自适应图标 foreground，背景色由 values/ic_launcher_background.xml 提供）
function renderIcon(size, { maskable = false, transparent = false, contentScale = 1, stars = true } = {}) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  if (!transparent) {
    // 夜色背景
    const g = ctx.createRadialGradient(size * 0.5, size * 0.36, size * 0.05, size * 0.5, size * 0.5, size * 0.72);
    g.addColorStop(0, '#3a2f56');
    g.addColorStop(0.55, '#241d33');
    g.addColorStop(1, '#141019');
    ctx.fillStyle = g;
    if (maskable) ctx.fillRect(0, 0, size, size);
    else { const r = size * 0.22; ctx.beginPath(); ctx.roundRect(0, 0, size, size, r); ctx.fill(); }
    // 星光
    if (stars) {
      for (let i = 0; i < 34; i++) {
        const x = (i * 97 % size), y = ((i * 53) % Math.floor(size * 0.5));
        px(ctx, x, y, Math.max(1, size / 128), Math.max(1, size / 128), i % 3 ? 'rgba(255,255,230,.55)' : 'rgba(255,255,230,.85)');
      }
    }
  }
  ctx.save();
  if (contentScale !== 1) { // 缩到中心（自适应图标只有中间 66% 安全区一定可见）
    ctx.translate(size / 2, size / 2);
    ctx.scale(contentScale, contentScale);
    ctx.translate(-size / 2, -size / 2);
  }
  const scale = size / 64; // 以 64 逻辑像素为设计基准
  // 地面
  px(ctx, size * 0.06, size * 0.78, size * 0.88, size * 0.09, '#2c2218');
  px(ctx, size * 0.06, size * 0.78, size * 0.88, Math.max(1, scale * 0.6), '#3d2f20');
  drawCampfire(ctx, 24 * scale, 40 * scale, 2.2 * scale);
  drawD20(ctx, size * 0.63, size * 0.42, size * 0.19);
  ctx.restore();
  return c.toBuffer('image/png');
}

const outputs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];
for (const [name, size, opts] of outputs) {
  writeFileSync(join(outDir, name), renderIcon(size, opts));
  console.log('✅ public/icons/' + name + ' (' + size + 'x' + size + ')');
}
// Electron/Windows 图标（512 PNG，electron-builder 自动转 ICO）
const buildDir = join(root, 'release', 'build');
if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, 'icon.png'), renderIcon(512, { maskable: true }));
console.log('✅ release/build/icon.png (512x512, electron-builder 自动转 .ico)');
// Android 资源图标（Capacitor android 工程 release/android/app/src/main/res）
const androidRes = join(root, 'release', 'android', 'app', 'src', 'main', 'res');
if (existsSync(androidRes)) {
  const dens = [['mipmap-mdpi', 48], ['mipmap-hdpi', 72], ['mipmap-xhdpi', 96], ['mipmap-xxhdpi', 144], ['mipmap-xxxhdpi', 192]];
  for (const [dir, size] of dens) {
    const d = join(androidRes, dir);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'ic_launcher.png'), renderIcon(size, { maskable: true }));
    writeFileSync(join(d, 'ic_launcher_round.png'), renderIcon(size, { maskable: true }));
  }
  // Android 8+ 自适应图标：foreground 需要 108dp 画布 + 中心安全区，否则系统会用 Capacitor 默认图标
  const fgDens = [['mipmap-mdpi', 108], ['mipmap-hdpi', 162], ['mipmap-xhdpi', 216], ['mipmap-xxhdpi', 324], ['mipmap-xxxhdpi', 432]];
  for (const [dir, size] of fgDens) {
    const d = join(androidRes, dir);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'ic_launcher_foreground.png'), renderIcon(size, { transparent: true, contentScale: 0.62 }));
  }
  // 自适应图标底色 = 夜色紫（原来是 Capacitor 的白色）
  const valuesDir = join(androidRes, 'values');
  if (existsSync(valuesDir)) {
    writeFileSync(join(valuesDir, 'ic_launcher_background.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#241D33</color>\n</resources>\n');
  }
  console.log('✅ android res/mipmap-*/ic_launcher(.round|_foreground).png（5 档密度 + 自适应图标）');
}
