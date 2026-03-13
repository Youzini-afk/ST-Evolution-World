/**
 * Evolution World — ST 扩展入口
 *
 * ST 通过 <script type="module"> 加载此文件。
 * jQuery/lodash/toastr 等全局变量由 ST 主页面提供。
 */
import { getSTContext } from './st-adapter';
import { initRuntime } from './runtime/main';
import { mountUI } from './ui/mount';

// 使用 globalThis.jQuery 而非 import 的 $，确保在 module scope 中能找到全局变量
const jq = (globalThis as any).jQuery || (globalThis as any).$;

if (typeof jq === 'function') {
  jq(() => {
    try {
      const ctx = getSTContext();
      console.info('[Evolution World] ST context ready, chatId:', ctx.chatId);

      // 初始化运行时 (settings, events, pipeline)
      initRuntime()
        .then(() => {
          // 运行时就绪后挂载 UI (FAB + 魔法棒 + 浮动面板)
          mountUI();
          (globalThis as any).toastr?.success?.('Evolution World 扩展已加载！', 'EW', { timeOut: 2000 });
        })
        .catch(error => {
          console.error('[Evolution World] Runtime init failed:', error);
          (globalThis as any).toastr?.error?.('Evolution World 初始化失败', 'EW');
        });
    } catch (error) {
      console.error('[Evolution World] Failed to load:', error);
    }
  });
} else {
  // jQuery 尚未加载，使用 DOMContentLoaded 作为后备
  console.warn('[Evolution World] jQuery not found, using DOMContentLoaded fallback');
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const ctx = getSTContext();
      console.info('[Evolution World] ST context ready (fallback), chatId:', ctx.chatId);

      initRuntime()
        .then(() => {
          mountUI();
          console.info('[Evolution World] Extension loaded (fallback path)');
        })
        .catch(error => {
          console.error('[Evolution World] Runtime init failed:', error);
        });
    } catch (error) {
      console.error('[Evolution World] Failed to load (fallback):', error);
    }
  });
}
