/**
 * SillyTavern API 适配层
 *
 * 封装 ST 原生 API，提供与旧 TavernHelper 运行时等效的接口。
 * 所有模块通过此文件访问 ST 功能，不直接依赖全局变量。
 */

// ── ST 全局类型声明 ──────────────────────────────────

/** SillyTavern 暴露的 context 对象（部分类型） */
export interface STContext {
  chat: any[];
  characters: any[];
  name1: string; // 用户名
  name2: string; // 角色名
  characterId: number;
  groupId: string | null;
  chatId: string;
  onlineStatus: string;
  maxContext: number;
  extensionSettings: Record<string, any>;
  saveSettingsDebounced: () => void;
  eventSource: STEventSource;
  event_types: Record<string, string>;
  getRequestHeaders: () => Record<string, string>;
  getCurrentChatId?: () => string;
  saveChat?: () => Promise<void>;
  saveChatConditional?: () => Promise<void>;
  deleteLastMessage?: () => Promise<void>;
  setExtensionPrompt?: (
    key: string,
    value: string,
    position: number,
    depth?: number,
    scan?: boolean,
    role?: number,
    filter?: unknown,
  ) => void;
  /** 发送一次 quiet generation */
  generateQuietPrompt: (
    prompt: string,
    quietToLoud?: boolean,
    skipWIAN?: boolean,
    quietImage?: string | null,
    quietName?: string | null,
    responseLength?: number,
  ) => Promise<string>;
}

export interface STEventSource {
  on: (event: string, handler: (...args: any[]) => void) => void;
  once: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
  emit: (event: string, ...args: any[]) => void;
  makeLast: (event: string, handler: (...args: any[]) => void) => void;
  makeFirst: (event: string, handler: (...args: any[]) => void) => void;
}

// ── 全局 context 获取 ─────────────────────────────────

/**
 * 获取 SillyTavern context。
 * ST 扩展通过 `SillyTavern.getContext()` 访问。
 *
 * 注意: 不缓存 context — ST 的 getContext() 每次返回最新快照，
 * chat/settings 等可能随时变化。
 */
export function getSTContext(): STContext {
  const st = (window as any).SillyTavern;
  if (!st || typeof st.getContext !== "function") {
    throw new Error(
      "[Evolution World] SillyTavern.getContext() 不可用 — 确保在 jQuery ready 后调用",
    );
  }

  return st.getContext() as STContext;
}

/**
 * 检查 SillyTavern context 是否可用（不抛出异常）。
 */
export function isSTReady(): boolean {
  const st = (window as any).SillyTavern;
  return !!(st && typeof st.getContext === "function");
}

/**
 * 获取 eventSource（事件总线）。
 * 替代旧的 `eventOn` / `tavern_events`。
 */
export function getEventSource(): STEventSource {
  return getSTContext().eventSource;
}

/**
 * 获取 event_types 枚举。
 * 替代旧的 `tavern_events`。
 */
export function getEventTypes(): Record<string, string> {
  return getSTContext().event_types;
}

// ── Settings 适配 ─────────────────────────────────────

const EW_SETTINGS_KEY = "evolution_world";

/**
 * 读取扩展 settings。
 * 替代 `getVariables({ type: 'script', script_id: getScriptId() })`。
 */
export function readExtensionSettings(): Record<string, any> {
  const ctx = getSTContext();
  if (!ctx.extensionSettings[EW_SETTINGS_KEY]) {
    ctx.extensionSettings[EW_SETTINGS_KEY] = {};
  }
  return ctx.extensionSettings[EW_SETTINGS_KEY];
}

/**
 * 写入扩展 settings 并触发持久化。
 * 替代 `insertOrAssignVariables`。
 */
export function writeExtensionSettings(data: Record<string, any>): void {
  const ctx = getSTContext();
  ctx.extensionSettings[EW_SETTINGS_KEY] = data;
  ctx.saveSettingsDebounced();
}

// ── 事件监听适配 ──────────────────────────────────────

type StopFn = () => void;

/**
 * 注册事件监听器。返回取消订阅函数。
 * 替代 `eventOn(tavern_events.XXX, handler)` 返回的 EventOnReturn。
 */
export function onSTEvent(
  eventName: string,
  handler: (...args: any[]) => void,
): StopFn {
  const es = getEventSource();
  es.on(eventName, handler);
  return () => es.removeListener(eventName, handler);
}

/**
 * 注册高优先级事件监听器（在其他监听器之前执行）。
 * 替代 `eventMakeFirst`。
 */
export function onSTEventFirst(
  eventName: string,
  handler: (...args: any[]) => void,
): StopFn {
  const es = getEventSource();
  if (typeof es.makeFirst === "function") {
    es.makeFirst(eventName, handler);
  } else {
    es.on(eventName, handler);
  }
  return () => es.removeListener(eventName, handler);
}

// ── 杂项工具 ──────────────────────────────────────────

/**
 * 获取当前 chat ID。
 */
export function getChatId(): string {
  return getSTContext().chatId;
}

/**
 * 获取 ST 请求头（包含 CSRF token 等）。
 */
export function getRequestHeaders(): Record<string, string> {
  return getSTContext().getRequestHeaders();
}
