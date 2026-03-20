/* ═══ Module Workbench — Type Definitions ═══ */
export const MODULE_CATEGORIES = [
    { id: 'source', label: '数据源', icon: '🔌', color: '#f59e0b', order: 0 },
    { id: 'filter', label: '过滤处理', icon: '🔍', color: '#3b82f6', order: 1 },
    { id: 'transform', label: '渲染转换', icon: '🔮', color: '#8b5cf6', order: 2 },
    { id: 'compose', label: '编排组装', icon: '📝', color: '#10b981', order: 3 },
    { id: 'execute', label: '执行调用', icon: '🚀', color: '#ef4444', order: 4 },
    { id: 'output', label: '输出写入', icon: '📤', color: '#14b8a6', order: 5 },
    { id: 'config', label: '配置参数', icon: '⚙', color: '#6366f1', order: 6 },
];
// ── Graph Utilities ──
/**
 * Check whether adding an edge from `source` to `target` would create a cycle.
 * Uses iterative BFS reachability from target → source.
 */
export function wouldCreateCycle(edges, source, target) {
    // If target can reach source through existing edges, adding source→target creates cycle
    const visited = new Set();
    const queue = [source];
    while (queue.length > 0) {
        const current = queue.shift();
        if (current === target)
            return true;
        if (visited.has(current))
            continue;
        visited.add(current);
        for (const edge of edges) {
            if (edge.source === current) {
                queue.push(edge.target);
            }
        }
    }
    return false;
}
//# sourceMappingURL=module-types.js.map