// 一次性工具：从两本5E规则书PDF提取纯文本，供AI DM检索引用
// 用法: node tools/extract-pdf.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jobs = [
  { file: '5eDnD_新手套组_规则_中译.pdf', out: 'data/rules/starter.txt' },
  { file: '5eDnD_城主指南_中译v1.1.pdf', out: 'data/rules/dmguide.txt' },
];

async function extract(src, dst) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(src));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  const parts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let text = '';
    let lastY = null;
    for (const item of tc.items) {
      if (!item.str) continue;
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 4) text += '\n';
      text += item.str;
      lastY = y;
    }
    parts.push('===== 第' + p + '页 =====\n' + text);
    if (p % 20 === 0) console.log(src.split('/').pop(), p + '/' + doc.numPages);
  }
  return parts.join('\n');
}

mkdirSync(join(root, 'data', 'rules'), { recursive: true });
for (const j of jobs) {
  const src = join(root, j.file);
  if (!existsSync(src)) { console.error('找不到规则书:', j.file); process.exitCode = 1; continue; }
  try {
    const text = await extract(src, join(root, j.out));
    writeFileSync(join(root, j.out), text, 'utf8');
    console.log('OK', j.out, text.length, '字符');
  } catch (e) {
    console.error('提取失败', j.file, e?.message || e);
    process.exitCode = 1;
  }
}
