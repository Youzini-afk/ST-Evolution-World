/**
 * Evolution World — ST 扩展入口
 *
 * ST 通过 <script type="module"> 加载此文件。
 * jQuery/lodash/toastr 等全局变量由 ST 主页面提供。
 */

// ── 最早的调试日志 ──
console.log('[Evolution World] ===== ENTRY POINT TOP-LEVEL =====');

let getSTContext: any;
let initRuntime: any;
let mountUI: any;

try {
  console.log('[Evolution World] Importing st-adapter...');
  const adapter = require('./st-adapter');
  getSTContext = adapter.getSTContext;
  console.log('[Evolution World] st-adapter imported OK');
} catch (err) {
  console.error('[Evolution World] FAILED to import st-adapter:', err);
}

try {
  console.log('[Evolution World] Importing runtime/main...');
  const main = require('./runtime/main');
  initRuntime = main.initRuntime;
  console.log('[Evolution World] runtime/main imported OK');
} catch (err) {
  console.error('[Evolution World] FAILED to import runtime/main:', err);
}

try {
  console.log('[Evolution World] Importing ui/mount...');
  const mount = require('./ui/mount');
  mountUI = mount.mountUI;
  console.log('[Evolution World] ui/mount imported OK');
} catch (err) {
  console.error('[Evolution World] FAILED to import ui/mount:', err);
}

// ── jQuery ready callback ──
const jq = (globalThis as any).jQuery || (globalThis as any).$;
console.log('[Evolution World] jQuery found:', typeof jq);

if (typeof jq === 'function') {
  jq(() => {
    console.log('[Evolution World] jQuery ready callback fired');
    try {
      if (!getSTContext) throw new Error('getSTContext not imported');
      const ctx = getSTContext();
      console.info('[Evolution World] ST context ready, chatId:', ctx.chatId);

      if (!initRuntime) throw new Error('initRuntime not imported');
      initRuntime()
        .then(() => {
          console.log('[Evolution World] Runtime init complete, mounting UI...');
          if (mountUI) {
            mountUI();
            (globalThis as any).toastr?.success?.('Evolution World 扩展已加载！', 'EW', { timeOut: 2000 });
          } else {
            console.error('[Evolution World] mountUI not available');
          }
        })
        .catch((error: any) => {
          console.error('[Evolution World] Runtime init failed:', error);
        });
    } catch (error) {
      console.error('[Evolution World] Failed in jQuery ready:', error);
    }
  });
} else {
  console.warn('[Evolution World] jQuery not found, using DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Evolution World] DOMContentLoaded fired');
    try {
      if (!getSTContext) throw new Error('getSTContext not imported');
      const ctx = getSTContext();
      console.info('[Evolution World] ST context ready (fallback), chatId:', ctx.chatId);

      if (!initRuntime) throw new Error('initRuntime not imported');
      initRuntime()
        .then(() => {
          console.log('[Evolution World] Runtime init complete (fallback), mounting UI...');
          if (mountUI) mountUI();
        })
        .catch((error: any) => {
          console.error('[Evolution World] Runtime init failed (fallback):', error);
        });
    } catch (error) {
      console.error('[Evolution World] Failed in DOMContentLoaded:', error);
    }
  });
}

console.log('[Evolution World] ===== ENTRY POINT SETUP DONE =====');
