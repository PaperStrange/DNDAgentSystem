#!/usr/bin/env node
// S2-6 门禁自测：在临时目录构造违规仓库，验证脚本可检出直提与命名违规
// 用法：node tools/ci-gate/selftest.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const check = join(here, 'compliance-check.mjs');
const tmp = mkdtempSync(join(tmpdir(), 's2-6-gate-test-'));
const repo = join(tmp, 'repo');

function git(cwd, ...a) {
  return execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '', GIT_CONFIG_SYSTEM: '' } }).trim();
}

try {
  git(tmp, 'init', '-q', '-b', 'main', 'repo');
  git(repo, 'config', 'user.name', 'Tester');
  git(repo, 'config', 'user.email', 'tester@test.bot');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'baseline commit');
  const baseline = git(repo, 'rev-parse', 'HEAD');
  // 违规1：直提 main（单亲开发提交）
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'illegal direct commit');
  // 违规2：不合规分支名
  git(repo, 'branch', 'feature-x');

  let failed = false;
  try {
    execFileSync('node', [check, 'all', '--repo', repo, '--baseline', baseline], { encoding: 'utf8', stdio: 'inherit' });
    console.error('❌ 自测失败：违规未被检出（退出码 0）');
    failed = true;
  } catch (e) {
    if (e.status === 1) console.log('✅ 自测通过：直提提交 + 不合规分支名均被检出，退出码 1');
    else {
      console.error('❌ 自测失败：异常退出码', e.status);
      failed = true;
    }
  }

  // 对照：合规场景应通过（基线取在非法直提之后，此后仅合并提交 + 规范分支名）
  const mid = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'branch', '-D', 'feature-x');
  git(repo, 'branch', 'S2-6-bob');
  git(repo, 'checkout', '-q', 'S2-6-bob');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'dev commit on card branch');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', 'S2-6-bob', '-m', 'merge commit');
  try {
    execFileSync('node', [check, 'direct-push', '--repo', repo, '--baseline', mid], { encoding: 'utf8', stdio: 'inherit' });
    console.log('✅ 对照通过：仅合并提交时直提检测放行');
  } catch {
    console.error('❌ 对照失败：合规合并提交被误判');
    failed = true;
  }
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
