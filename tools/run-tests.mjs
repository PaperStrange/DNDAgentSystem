// 测试聚合入口（`npm test`）
//
// 背景：仓库此前没有 test 聚合入口，只能手工逐文件跑；且 `node --test <目录>` 在
// Windows 上会报 MODULE_NOT_FOUND（Node 已知行为），必须传具体文件路径。
// 本脚本负责发现 tests/ 下所有 *.test.mjs，拼成文件列表交给 node --test 执行。
//
// 安全约束（RD-019：实现时严格遵循扫描校验、无安全漏洞）：
//   1. 全程不使用 shell（spawn 不传 shell:true），文件路径作为参数数组传递 → 无命令注入面
//   2. 只收集 tests/ 目录内、且解析后仍在 tests/ 下的 .test.mjs → 防路径穿越
//   3. 不 eval、不动态 import 被测文件本身（交由 node --test 子进程隔离执行）
//   4. 无网络访问、无密钥读取、无写操作（除临时无）
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve, sep, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(join(fileURLToPath(import.meta.url), '..', '..'));
const testsDir = resolve(appRoot, 'tests');

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collect(p, out);
    else if (name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

const files = collect(testsDir)
  .map((p) => resolve(p))
  // 路径穿越防护：解析后必须仍在 tests/ 内
  .filter((p) => p === testsDir || p.startsWith(testsDir + sep))
  .sort();

if (!files.length) {
  console.error('[test] 未发现任何 *.test.mjs（搜索目录：' + testsDir + '）');
  process.exit(1);
}

console.log('[test] 共发现 ' + files.length + ' 个测试文件：');
for (const f of files) console.log('  · ' + relative(appRoot, f).split(sep).join('/'));
console.log('');

const child = spawn(process.execPath, ['--test', ...files], {
  cwd: appRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code) => {
  if (code === 0) console.log('\n[test] 全部通过');
  else console.error('\n[test] 存在失败，退出码 ' + code);
  process.exit(code === null ? 1 : code);
});
