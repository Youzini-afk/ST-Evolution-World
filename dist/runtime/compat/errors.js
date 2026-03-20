/**
 * Compat: 错误处理
 *
 * 替代旧的 `errorCatched` 全局。
 */
/**
 * 包装函数,捕获同步/异步错误并 console.error。
 * 替代旧 `errorCatched(fn)` — 返回原函数的执行结果。
 */
export function errorCatched(fn) {
    return ((...args) => {
        try {
            const result = fn(...args);
            if (result && typeof result.catch === 'function') {
                return result.catch((error) => {
                    console.error('[Evolution World] errorCatched:', error);
                    throw error;
                });
            }
            return result;
        }
        catch (error) {
            console.error('[Evolution World] errorCatched:', error);
            throw error;
        }
    });
}
//# sourceMappingURL=errors.js.map