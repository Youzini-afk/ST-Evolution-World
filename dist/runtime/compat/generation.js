/**
 * Compat: 生成控制
 *
 * 替代旧的 stopGenerationById / stopAllGeneration / resolveGenerateRaw。
 *
 * 关键变更:
 * - generateRaw IS available on getContext() — llm_connector 模式可保留。
 * - stopGenerationById 不存在于 ST,降级为 stopGeneration()。
 */
import { getSTContext } from '../../st-adapter';
/**
 * 获取 generateRaw 函数。
 * ST getContext() 直接暴露 generateRaw。
 * 替代旧的 `resolveGenerateRaw()` / `getHostRuntime().generateRaw`。
 */
export function resolveGenerateRaw() {
    const ctx = getSTContext();
    if (typeof ctx.generateRaw === 'function') {
        return ctx.generateRaw;
    }
    return null;
}
/**
 * 停止当前生成。
 * 替代旧的 `stopAllGeneration()`。
 */
export function stopGeneration() {
    const ctx = getSTContext();
    if (typeof ctx.stopGeneration === 'function') {
        ctx.stopGeneration();
        return;
    }
    console.warn('[Compat] stopGeneration: not available on context');
}
/**
 * 停止指定 ID 的生成 — 降级为停止全部。
 *
 * ST 不支持按 ID 精确停止,降级为 stopGeneration()。
 * 替代旧的 `stopGenerationById(id)`。
 *
 * @returns true 如果成功停止 (始终 true,因为是降级)
 */
export function stopSpecificGeneration(_generationId) {
    console.debug(`[Compat] stopSpecificGeneration('${_generationId}'): ST 不支持按 ID 停止,降级为 stopGeneration()`);
    stopGeneration();
    return true;
}
/**
 * 获取 ST 请求头(含 CSRF token 等,及 Content-Type)。
 * 替代旧 dispatcher.ts 中的 `getStRequestHeaders()`。
 */
export function getStRequestHeaders() {
    const ctx = getSTContext();
    const headers = { 'Content-Type': 'application/json' };
    if (typeof ctx.getRequestHeaders === 'function') {
        Object.assign(headers, ctx.getRequestHeaders());
    }
    headers['Content-Type'] = 'application/json';
    return headers;
}
/**
 * 获取 ST context (通用)。
 * 替代旧 dispatcher.ts 中的 `getSillyTavernContext()`。
 */
export function getSillyTavernContext() {
    return getSTContext();
}
//# sourceMappingURL=generation.js.map