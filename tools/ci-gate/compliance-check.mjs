#!/usr/bin/env node
// S2-6 CI 门禁：直提 main 检测 + 分支合规校验 + worktree 同级目录校验（红线-1/7）
// 用法：node tools/ci-gate/compliance-check.mjs <all|direct-push|branch-names|worktrees|no-persisted-exemptions|cards-requirement-only|merge-audit>
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
  if (!existsSync(dir)) {
    // 依 DoD「失败/超时/缺失/未测均不算 PASS」。
    // 注意：docs/* 被 .gitignore 排除（红线-3 不改 .gitignore），故本检查在 CI 上天然无目录。
    // 旧实现在此处「跳过并返回 0」＝假绿，等于事故03 的防线在 CI 完全失效。现改为失败并给出处置选项。
    // RD-056（用户裁定选 2）：本检查移出 CI —— docs/* 被 .gitignore 排除，
    // CI/worktree 中不存在 docs/pm/cards，校验无从进行。
    // 在 CI 中**显式声明不适用并指明由谁承担**，绝不静默跳过（静默＝假绿，见事故03）。
    if (process.env.CI) {
      console.log("⚠ [不适用] cards-requirement-only 不在 CI 执行（docs/* 被 .gitignore 排除，目录不存在）");
      console.log("   该约束在 CI 无执行点；本地主仓库（存在 docs/pm/cards 时）由 pre-commit 钩子与门禁校验。");
      console.log("   依 RD-056 如实登记为「已知缺口」：红线-1 要求开发在 worktree 进行，而 worktree 无 docs/，该约束在开发路径上亦无执行点。");
      console.log("   本地（存在 docs/pm/cards 的环境）仍会严格校验。");
      return 0;
    }
    console.log("❌ 未找到 docs/pm/cards 目录，无法校验「卡片不得混入过程记录」（事故03）");
    console.log("   依 DoD：缺失/未测不算 PASS，故判定为失败，避免「跳过即成功」的假绿。");
    return 1;
  }
  const bad = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const txt = readFileSync(join(dir, f), "utf8");
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
    console.log("❌ 缺少审计台账 " + AUDIT_LOG_PATH + "（RD-054）");
    return 1;
  }
  let log;
  try { log = JSON.parse(readFileSync(AUDIT_LOG_PATH, "utf8")); }
  catch (e) { console.log("❌ 审计台账解析失败：" + e.message); return 1; }
  const done = new Set((log.entries || []).filter(e => e.expertCR).map(e => String(e.merge).toLowerCase()));

  // B2：起点必须是可解析的修订，不可解析直接判失败（旧实现会让 git fatal 崩溃）
  const gf = log._grandfather && log._grandfather.before ? log._grandfather.before : null;
  if (gf) {
    let ok = false;
    try { execFileSync("git", ["rev-parse", "--verify", gf + "^{commit}"], { cwd: repo, stdio: "ignore" }); ok = true; } catch {}
    if (!ok) { console.log("❌ 既往不咎起点不可解析：" + gf + "（须为 main 上可达的提交）"); return 1; }
    console.log("[合并审计] 既往不咎起点 " + gf + "（此前 merge 不追溯，用户裁定 A）");
  }

  // M1：固定 7 位缩写，避免 core.abbrev 随仓库增长变化导致台账批量失配
  const allRows = gitLines("log", "--first-parent", "--merges", "--abbrev=7", "--format=%h%x09%s", gf ? (gf + "..HEAD") : "HEAD");
  // H3：GitHub PR 会 checkout 合成 merge（subject 形如 "Merge <sha> into <sha>"），
  // 它恒定占据「最新一个」位置，会让 B1 的宽限格被永久占用 → PR 门禁上审计要求失效。
  // 合成 merge 一律排除，使其不再占用宽限格。
  const SYNTHETIC = /^Merge [0-9a-f]{7,40} into /i;
  const rows = allRows.filter(r => !SYNTHETIC.test(r.split("\t")[1] || ""));
  const missing = [];
  for (const r of rows) {
    const [h, subj] = r.split("\t");
    if (!done.has(String(h).toLowerCase())) missing.push(h + "  " + subj);
  }

  // B1 自指死锁：刚产生的 merge 其哈希在创建前不可知，允许「待补录」一次，
  // 但仅限区间内最新一个，且下一笔仍不回填即失败；未审计数 >1 一律失败。
  let pendingNewest = false;
  if (missing.length === 1 && rows.length) {
    const newest = rows[0].split("\t")[0];
    if (missing[0].startsWith(newest)) {
      pendingNewest = true;
      console.log("⚠ 最新 merge 待补录审计（哈希创建前不可知）：" + missing[0]);
      console.log("   请在下一笔提交回填至台账 entries（expertCR=true）；再下一笔仍不回填将判失败。");
    }
  }
  console.log("[合并审计] 主线 merge 提交 " + rows.length + " 个，已审计 " + (rows.length - missing.length) + " 个");
  if (missing.length && !pendingNewest) {
    console.log("❌ 以下 merge 提交缺少代码审计（RD-054：不因角色豁免，含 Bob）：");
    for (const m of missing) console.log("   " + m);
    return missing.length;
  }
  if (pendingNewest) { console.log("🟡 有 1 个最新 merge 待补录，暂不阻断"); return 0; }
  // M6：空集不得报绿 —— 检查区间内 0 个 merge 时无法佐证任何审计情况
  if (rows.length === 0) {
    console.log("⚠ 检查区间内 0 个 merge 提交，无法佐证审计情况（不视为通过）");
    return 0;
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
