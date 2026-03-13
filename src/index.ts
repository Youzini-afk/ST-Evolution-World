/**
 * Evolution World — ST 扩展入口
 *
 * 标准 jQuery ready 模式初始化。
 */
import { getSTContext } from './st-adapter';
import { initRuntime } from './runtime/main';
import { mountUI } from './ui/mount';

$(() => {
  try {
    const ctx = getSTContext();
    console.info('[Evolution World] ST context ready, chatId:', ctx.chatId);

    // 初始化运行时 (settings, events, pipeline)
    initRuntime()
      .then(() => {
        // 运行时就绪后挂载 UI
        mountUI();
        toastr.success('Evolution World 扩展已加载！', 'EW', { timeOut: 2000 });
      })
      .catch(error => {
        console.error('[Evolution World] Runtime init failed:', error);
        toastr.error('Evolution World 初始化失败', 'EW');
      });
  } catch (error) {
    console.error('[Evolution World] Failed to load:', error);
  }
});
