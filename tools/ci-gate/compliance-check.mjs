#!/usr/bin/env node
// S2-6 CI 门禁：直提 main 检测 + 分支合规校验 + worktree 同级目录校验（红线-1/7）
// 用法：node tools/ci-gate/compliance-check.mjs <all|direct-push|branch-names|worktrees>
//       [--repo <路径>] [--baseline <ref>]
// 退出码：0=全部合规，1=存在违规
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'all';
const repoIdx = args.indexOf('--repo');
const repo = repoIdx >= 0 ? args[repoIdx + 1] : '.';
const baseIdx = args.indexOf('--baseline');

function git(...a) {
  return execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
}
function gitLines(...a) {
  const out = git(...a);
  return out ? out.split('\n') : [];
}

// 命名规范：main 或 <card-id>-<owner>，如 S2-6-bob / S3-1-hua
const CARD_BRANCH = /^(main|[A-Z]+\d+-\d+-[a-z0-9]+)$/;
// 合并门禁基线（S2-2 合并前终点），可被 --baseline 覆盖
const DEFAULT_BASELINE = '7e1c9e3';

function checkDirectPush() {
  const baseline = baseIdx >= 0 ? args[baseIdx + 1] : DEFAULT_BASELINE;
  const fmt = '--format=%H%x09%P%x09%an <%ae>%x09%s';
  // 只看 main 第一父链：经合并提交带入的卡片分支单亲提交属合规，
  // 出现在第一父链上的非合并提交才是直提
  const rows = gitLines('log', '--first-parent', fmt, `${baseline}..HEAD`);
  const violations = [];
  for (const r of rows) {
    const [hash, parents, who, subject] = r.split('\t');
    const parentCount = parents.trim() ? parents.trim().split(/\s+/).length : 0;
    if (parentCount < 2) violations.push({ hash: hash.slice(0, 7), who, subject });
  }
  console.log(`[直提检测] 基线=${baseline}，main 新增提交 ${rows.length} 笔`);
  if (violations.length) {
    console.log('❌ 检出直提 main 提交（单亲开发提交，违反红线-7）：');
    for (const v of violations) console.log(`   ${v.hash}  ${v.who}  ${v.subject}`);
  } else {
    console.log('✅ 新增提交均为合并提交，合规');
  }
  return violations.length;
}

function checkBranchNames() {
  // 用完整引用名，排除远程 HEAD 引用（refs/remotes/*/HEAD 非开发分支）
  const raw = gitLines('for-each-ref', 'refs/heads', 'refs/remotes', '--format=%(refname)');
  const branches = [...new Set(
    raw
      .filter(r => r && !/^refs\/remotes\/[^/]+\/HEAD$/.test(r))
      .map(r => r.replace('refs/heads/', '').replace(/^refs\/remotes\/[^/]+\//, ''))
  )];
  const bad = branches.filter(b => !CARD_BRANCH.test(b));
  console.log(`[分支合规] 校验分支 ${branches.length} 个（规范：main 或 <card-id>-<owner>）`);
  if (bad.length) {
    console.log('❌ 不合规分支名：');
    for (const b of bad) console.log(`   ${b}`);
  } else {
    console.log('✅ 分支命名全部合规');
  }
  return bad.length;
}

function checkWorktrees() {
  const lines = gitLines('worktree', 'list', '--porcelain');
  const entries = [];
  let cur = {};
  for (const line of lines) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9) };
    else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace('refs/heads/', '');
      entries.push(cur);
    }
  }
  const mainEntry = entries.find(e => e.branch === 'main');
  if (!mainEntry) {
    console.log('[worktree校验] 未找到 main worktree，跳过');
    return 0;
  }
  const mainDir = dirname(resolve(mainEntry.path));
  const bad = entries.filter(e => e.branch !== 'main' && dirname(resolve(e.path)) !== mainDir);
  console.log(`[worktree校验] 卡片 worktree ${entries.length - 1} 个（红线-1：须为主仓库同级目录）`);
  if (bad.length) {
    console.log('❌ worktree 位置不合规：');
    for (const b of bad) console.log(`   ${b.branch} → ${b.path}`);
  } else {
    console.log('✅ worktree 位置全部合规');
  }
  return bad.length;
}

const targets = cmd === 'all' ? ['direct-push', 'branch-names', 'worktrees'] : [cmd];
let total = 0;
for (const t of targets) {
  if (t === 'direct-push') total += checkDirectPush();
  else if (t === 'branch-names') total += checkBranchNames();
  else if (t === 'worktrees') total += checkWorktrees();
  else {
    console.error(`未知子命令：${t}`);
    process.exit(2);
  }
}
console.log(total ? `⛔ 共 ${total} 项违规，门禁不通过` : '🟢 门禁通过，无违规');
process.exit(total ? 1 : 0);
