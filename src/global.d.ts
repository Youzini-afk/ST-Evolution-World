/**
 * 全局类型声明
 *
 * 声明 SillyTavern 主页面提供的全局变量和函数。
 * 替代旧 TavernHelper 运行时注入的类型。
 */

// ── SillyTavern 全局 API ──
declare const SillyTavern: {
  getContext(): import('./st-adapter').STContext;
  getCurrentChatId(): string;
  chat: any[];
  stopGeneration?(): void;
};

// ── jQuery（ST 主页面提供）──
declare const jQuery: JQueryStatic;
declare const $: JQueryStatic;

// ── Lodash（ST 主页面提供）──
declare const _: typeof import('lodash');

// ── Toastr（ST 主页面提供）──
declare const toastr: {
  success(message: string, title?: string, options?: any): void;
  info(message: string, title?: string, options?: any): void;
  warning(message: string, title?: string, options?: any): void;
  error(message: string, title?: string, options?: any): void;
};

// ── Klona ──
declare function klona<T>(val: T): T;

// ── SillyTavern Chat API ──
declare function getChatMessages(
  messageIdOrRange: number | string,
  options?: { hide_state?: string },
): Array<{ role: string; message: string; data?: Record<string, unknown> }>;

declare function setChatMessages(
  updates: Array<{ message_id: number; data?: Record<string, unknown> }>,
  options?: { refresh?: string },
): Promise<void>;

declare function getLastMessageId(): number;

declare function stopAllGeneration(): void;

// ── SillyTavern Macro 替换 ──
declare function substitudeMacros(text: string): string;

// ── SillyTavern 世界书 API ──
declare function getWorldInfoEntries(
  worldName: string,
): Promise<Array<{ uid: string; key: string[]; content: string; [k: string]: any }>>;

declare function setWorldInfoEntry(
  worldName: string,
  uid: string,
  entry: Record<string, any>,
): Promise<void>;

// ── SillyTavern 网络请求 ──
declare function getRequestHeaders(): Record<string, string>;

// ── Zod (从 node_modules 导入，但某些旧文件用全局 z) ──
declare namespace z {
  interface ZodError {
    issues: Array<{
      message: string;
      path?: (string | number)[];
      input?: unknown;
    }>;
  }
}

// ── YAML (ST 全局) ──
declare const YAML: {
  parseDocument(content: string, options?: any): { toJS(): any };
  stringify(value: any, options?: any): string;
};

// ── Vue 全局 (由 webpack 打包) ──
declare function reactive<T extends object>(target: T): T;
declare function readonly<T extends object>(target: T): Readonly<T>;
declare function inject<T>(key: string): T | undefined;

// ── 模块声明 ──
declare module '*.vue' {
  import { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module '*.html' {
  const content: string;
  export default content;
}
