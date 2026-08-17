// OpenAI兼容API客户端：任何失败都返回null，由调用方降级
import { config, llmEnabled } from './config.mjs';

export function llmAvailable() { return llmEnabled(); }

export async function chat(messages, { temperature, timeoutMs, json = false } = {}) {
  if (!llmAvailable()) return null;
  const { baseURL, apiKey, model } = config.llm;
  const url = baseURL.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model, messages,
    temperature: temperature ?? config.llm.temperature,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || config.llm.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) { console.warn('[llm] HTTP', res.status, (await res.text()).slice(0, 200)); return null; }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? { text: text.trim() } : null;
  } catch (e) {
    console.warn('[llm] 调用失败:', e?.name || e?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function extractJson(text) {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch { return null; }
}
