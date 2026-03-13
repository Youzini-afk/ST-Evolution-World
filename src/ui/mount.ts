/**
 * Vue UI 挂载逻辑
 *
 * 将 Vue 应用挂载到 SillyTavern 的扩展设置面板。
 * 替代旧的 createScriptIdDiv + teleportStyle 模式。
 */

import { createApp, type App as VueApp } from 'vue';
import { createPinia } from 'pinia';
import AppComponent from './App.vue';

const CONTAINER_ID = 'ew-extension-root';

let app: VueApp | null = null;
let $container: JQuery | null = null;

/**
 * 在 ST 扩展设置区域创建 UI 容器并挂载 Vue 应用。
 *
 * ST 扩展的标准 UI 挂载方式：
 * - 找到 `#extensions_settings2`（ST 扩展设置面板容器）
 * - 在其中创建一个 wrapper div
 * - 用户点击扩展名时，ST 会 toggle 该 div 的显示
 */
export function mountUI(): void {
  if (app) return;

  // 创建扩展设置容器
  const $wrapper = $(`
    <div class="ew-extension-wrapper">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>Evolution World</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" id="${CONTAINER_ID}">
        </div>
      </div>
    </div>
  `);

  // 追加到 ST 扩展设置面板
  $('#extensions_settings2').append($wrapper);
  $container = $wrapper;

  // 创建并挂载 Vue 应用
  const pinia = createPinia();
  app = createApp(AppComponent);
  app.use(pinia);
  app.mount(`#${CONTAINER_ID}`);

  console.info('[Evolution World] Vue UI 已挂载');
}

/**
 * 卸载 Vue 应用并移除 DOM 容器。
 */
export function unmountUI(): void {
  if (app) {
    app.unmount();
    app = null;
  }

  if ($container) {
    $container.remove();
    $container = null;
  }

  console.info('[Evolution World] Vue UI 已卸载');
}
