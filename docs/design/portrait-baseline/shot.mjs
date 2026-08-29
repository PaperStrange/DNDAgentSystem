import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 384, height: 480 } });
await page.goto('file:///' + join(dir, 'portrait-baseline-human-male-v0.1.svg').replace(/\\/g, '/'));
await page.screenshot({ path: join(dir, 'portrait-baseline-human-male-v0.1.png') });
await browser.close();
console.log('PNG OK');
