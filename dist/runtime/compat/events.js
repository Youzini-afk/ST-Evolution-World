/**
 * Compat: 事件系统
 *
 * 替代旧的 eventOn / tavern_events / iframe_events。
 * 内部统一走 ST context 的 eventSource + event_types。
 */
import { getSTContext } from '../../st-adapter';
// ── 事件名称辅助 ──────────────────────────────────────
/**
 * 获取 ST 事件名称枚举 (event_types / eventTypes)。
 * 替代旧 `tavern_events` 和 `iframe_events` 常量对象。
 */
export function getEventTypes() {
    const ctx = getSTContext();
    return ctx.eventTypes ?? ctx.event_types ?? {};
}
// ── 事件监听 ──────────────────────────────────────────
/**
 * 注册事件监听器,返回取消函数。
 * 替代旧 `eventOn(tavern_events.XXX, handler)` 返回的 EventOnReturn。
 */
export function onEvent(eventName, handler) {
    const es = getSTContext().eventSource;
    es.on(eventName, handler);
    return () => es.removeListener(eventName, handler);
}
/**
 * 注册一次性事件监听器。
 * 替代旧 `eventOnce`。
 */
export function onEventOnce(eventName, handler) {
    const es = getSTContext().eventSource;
    es.once(eventName, handler);
    return () => es.removeListener(eventName, handler);
}
/**
 * 注册高优先级事件监听器(在其它 handler 之前执行)。
 * 替代旧 `eventMakeFirst`。
 */
export function onEventFirst(eventName, handler) {
    const es = getSTContext().eventSource;
    if (typeof es.makeFirst === 'function') {
        es.makeFirst(eventName, handler);
    }
    else {
        es.on(eventName, handler);
    }
    return () => es.removeListener(eventName, handler);
}
// ── 旧常量映射 (运行时获取) ──────────────────────────
/**
 * 获取 CHAT_CHANGED 事件名。
 * 替代旧 `tavern_events.CHAT_CHANGED`。
 */
export function EVENT_CHAT_CHANGED() {
    return getEventTypes().CHAT_CHANGED ?? 'chatChanged';
}
/**
 * 获取 MESSAGE_DELETED 事件名。
 * 替代旧 `tavern_events.MESSAGE_DELETED`。
 */
export function EVENT_MESSAGE_DELETED() {
    return getEventTypes().MESSAGE_DELETED ?? 'messageDeleted';
}
/**
 * 获取 STREAM_TOKEN_RECEIVED 事件名。
 * 替代旧 `iframe_events.STREAM_TOKEN_RECEIVED_FULLY`。
 *
 * 注意: ST 扩展中没有 iframe_events 概念。
 * ST 的事件名为 STREAM_TOKEN_RECEIVED 或类似。
 * 流式回调签名: (fullText: string, streamGenerationId?: string) => void
 */
export function EVENT_STREAM_TOKEN() {
    const types = getEventTypes();
    return types.STREAM_TOKEN_RECEIVED ?? types.STREAM_TOKEN_RECEIVED_FULLY ?? 'streamTokenReceived';
}
/**
 * 获取 GENERATION_STARTED 事件名。
 */
export function EVENT_GENERATION_STARTED() {
    return getEventTypes().GENERATION_STARTED ?? 'generationStarted';
}
/**
 * 获取 GENERATION_AFTER_COMMANDS 事件名。
 */
export function EVENT_GENERATION_AFTER_COMMANDS() {
    return getEventTypes().GENERATION_AFTER_COMMANDS ?? 'generationAfterCommands';
}
/**
 * 获取 MESSAGE_RECEIVED 事件名。
 */
export function EVENT_MESSAGE_RECEIVED() {
    return getEventTypes().MESSAGE_RECEIVED ?? 'messageReceived';
}
/**
 * 获取 MESSAGE_SENT 事件名。
 */
export function EVENT_MESSAGE_SENT() {
    return getEventTypes().MESSAGE_SENT ?? 'messageSent';
}
/**
 * 获取 CHARACTER_MESSAGE_RENDERED 事件名。
 */
export function EVENT_CHARACTER_MESSAGE_RENDERED() {
    return getEventTypes().CHARACTER_MESSAGE_RENDERED ?? 'characterMessageRendered';
}
/**
 * 获取 USER_MESSAGE_RENDERED 事件名。
 */
export function EVENT_USER_MESSAGE_RENDERED() {
    return getEventTypes().USER_MESSAGE_RENDERED ?? 'userMessageRendered';
}
//# sourceMappingURL=events.js.map