// S3-1 打包适配：应用根目录与可写数据目录解析
// - 开发/自托管：dataRoot = <项目根>/data（与历史行为一致，零变化）
// - 打包（Electron asar / 原生壳）：设置 DND_DATA_DIR 指向用户可写目录（如 %APPDATA%），
//   避免向只读的应用包内写账户库与冒险日志
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const dataRoot = process.env.DND_DATA_DIR ? String(process.env.DND_DATA_DIR) : join(appRoot, 'data');
