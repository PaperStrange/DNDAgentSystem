// 配置加载：config.json > 环境变量 > 默认值
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = join(root, 'config.json');
const examplePath = join(root, 'config.example.json');

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

let cfg = {};
try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); }
catch {
  if (existsSync(examplePath)) {
    try { cfg = JSON.parse(readFileSync(examplePath, 'utf8')); } catch {}
    try { writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch {}
  }
}

const env = process.env;
cfg.port = Number(env.DND_PORT || cfg.port || 3000);
if (env.DND_SEED !== undefined && env.DND_SEED !== '') cfg.seed = Number(env.DND_SEED);
cfg.llm = cfg.llm || {};
if (env.DND_LLM_BASE_URL) cfg.llm.baseURL = env.DND_LLM_BASE_URL;
if (env.DND_LLM_KEY) cfg.llm.apiKey = env.DND_LLM_KEY;
if (env.DND_LLM_MODEL) cfg.llm.model = env.DND_LLM_MODEL;
if (env.DND_OFFLINE === '1') cfg.llm.apiKey = '';
cfg.llm.timeoutMs = Number(cfg.llm.timeoutMs || 45000);
cfg.llm.temperature = Number(cfg.llm.temperature ?? 0.8);

export const config = cfg;
export const llmEnabled = () => !!(cfg.llm?.apiKey && cfg.llm?.baseURL && cfg.llm?.model);
