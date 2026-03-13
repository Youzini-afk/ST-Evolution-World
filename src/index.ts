/**
 * ST-Evolution-World 入口点
 *
 * 这是 SillyTavern 加载扩展时执行的主文件。
 * 负责：
 * 1. 注册 settings UI panel
 * 2. 初始化运行时（events、settings）
 * 3. 挂载 Vue UI
 */

import { getSTContext } from './st-adapter';
import { mountUI, unmountUI } from './ui/mount';

const EXTENSION_NAME = 'Evolution World';

async function init() {
  try {
    const ctx = getSTContext();
    console.info(`[${EXTENSION_NAME}] 扩展加载中...`);

    // 挂载 Vue UI 到 ST 扩展设置面板
    mountUI();

    // TODO: Round 2 — 初始化运行时（events、pipeline）
    // await initRuntime();

    console.info(`[${EXTENSION_NAME}] 扩展已就绪 ✓`);
    toastr.success(`${EXTENSION_NAME} 已加载`, EXTENSION_NAME, { timeOut: 2000 });
  } catch (error) {
    console.error(`[${EXTENSION_NAME}] 初始化失败:`, error);
    toastr.error(
      `${EXTENSION_NAME} 加载失败: ${error instanceof Error ? error.message : String(error)}`,
      EXTENSION_NAME,
    );
  }
}

// jQuery ready — ST 扩展的标准启动方式
jQuery(async () => {
  await init();
});
