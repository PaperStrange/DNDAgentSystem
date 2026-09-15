#!/usr/bin/env node
// S2-6 CI 门禁：直提 main 检测 + 分支合规校验 + worktree 同级目录校验（红线-1/7）
// 用法：node tools/ci-gate/compliance-check.mjs <all|direct-push|branch-names|worktrees>
//       [--repo <路径>] [--baseline <ref>]
// 退出码：0=全部合规，1=存在违规
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
// RD-036：本路径存在即视为「豁免被持久化」，门禁必须失败（不允许长期规则）
const EXCEPTIONS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'known-exceptions.json');
// RD-054：合并前代码审计台账，缺条目即失败
const AUDIT_LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'audit-log.json');

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


// RD-036：豁免不得持久化。若出现持久化豁免清单文件，说明有人把一次性豁免写成了长期规则。
function checkNoPersistedExemptions() {
  if (existsSync(EXCEPTIONS_PATH)) {
    console.log("❌ 检测到持久化的豁免清单文件（违反 RD-036：豁免不得落地为长期规则）：");
    console.log("   " + EXCEPTIONS_PATH);
    console.log("   历史直提确需放行时，请用一次性 --baseline 参数，不要写文件。");
    return 1;
  }
  console.log("✅ 无持久化豁免清单（RD-036 合规）");
  return 0;
}

// 事故03：卡片是需求文档，不得混入开发过程记录。
const PROCESS_HEADINGS = /^##\s*(排查进展|处置方案|处置（已执行）|起因（事实）|验收（Kelly|当前缓解措施|测量结果|为什么仍未关闭|已达成|未达成)/m;
function checkCardsRequirementOnly() {
  const dir = join(resolve(repo, "."), "docs", "pm", "cards");
  if (!existsSync(dir)) { console.log("✅ 无 cards 目录，跳过"); return 0; }
  const bad = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const txt = fs.readFileSync(join(dir, f), "utf8");
    if (PROCESS_HEADINGS.test(txt)) bad.push(f);
  }
  if (bad.length) {
    console.log("❌ 以下需求卡片混入了开发过程记录（违反工件职责边界，见事故03）：");
    for (const b of bad) console.log("   docs/pm/cards/" + b);
    console.log("   过程内容应放 docs/pm/reports/ 或 docs/qa/<run>/。");
    return bad.length;
  }
  console.log("✅ 卡片均为需求-only（无过程性章节）");
  return 0;
}


// RD-054：合并前代码审计不因角色豁免（含 Bob 的 merge 提交）。
// 主线上的每个 merge 提交都必须在审计台账中有 expertCR=true 的条目，缺失即失败。
function checkMergeAudit() {
  if (!existsSync(AUDIT_LOG_PATH)) {
    console.log("❌ 缺少审计台账 docs/pm/audit-log.json（RD-054）");
    return 1;
  }
  const log = JSON.parse(readFileSync(AUDIT_LOG_PATH, "utf8"));
  const done = new Set((log.entries || []).filter(e => e.expertCR).map(e => String(e.merge).toLowerCase()));
  // 取主线第一父链上的 merge 提交
  const rows = gitLines("log", "--first-parent", "--merges", "--format=%h%x09%s");
  const missing = [];
  for (const r of rows) {
    const [h, subj] = r.split("\t");
    if (!done.has(String(h).toLowerCase())) missing.push(h + "  " + subj);
  }
  console.log("[合并审计] 主线 merge 提交 " + rows.length + " 个，已审计 " + (rows.length - missing.length) + " 个");
  if (missing.length) {
    console.log("❌ 以下 merge 提交缺少代码审计（RD-054：不因角色豁免，含 Bob）：");
    for (const m of missing) console.log("   " + m);
    return missing.length;
  }
  console.log("✅ 全部 merge 提交均有代码审计（RD-054 合规）");
  return 0;
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

const ALL_TARGETS = ['direct-push', 'branch-names', 'worktrees', 'no-persisted-exemptions', 'cards-requirement-only', 'merge-audit'];
const targets = cmd === 'all' ? ALL_TARGETS : [cmd];
let total = 0;
for (const t of targets) {
  if (t === 'direct-push') total += checkDirectPush();
  else if (t === 'branch-names') total += checkBranchNames();
  else if (t === 'worktrees') total += checkWorktrees();
  else if (t === 'no-persisted-exemptions') total += checkNoPersistedExemptions();
  else if (t === 'cards-requirement-only') total += checkCardsRequirementOnly();
  else if (t === 'merge-audit') total += checkMergeAudit();
  else {
    console.error(`未知子命令：${t}`);
    process.exit(2);
  }
}
console.log(total ? `⛔ 共 ${total} 项违规，门禁不通过` : '🟢 门禁通过，无违规');
process.exit(total ? 1 : 0);
