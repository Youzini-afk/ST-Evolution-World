/* ═══ Module Implementations — Compose Modules ═══ */
/*
 * Runtime implementations for Compose-category modules.
 * These assemble, order, and inject messages into the final prompt.
 */
// ── Prompt Order ──
/**
 * Sort prompt components by a user-defined prompt_order array.
 * Each component is identified by a key and contains a messages array.
 *
 * prompt_order: [{ identifier: string, enabled: boolean }]
 */
export function composePromptOrder(components, promptOrder) {
    if (!components || typeof components !== 'object')
        return [];
    // If no prompt order, just flatten all components
    if (!promptOrder || promptOrder.length === 0) {
        const result = [];
        for (const [_key, value] of Object.entries(components)) {
            if (Array.isArray(value)) {
                result.push(...value);
            }
            else if (typeof value === 'string' && value) {
                result.push({ role: 'system', content: value });
            }
        }
        return result;
    }
    const result = [];
    for (const entry of promptOrder) {
        if (!entry.enabled)
            continue;
        const component = components[entry.identifier];
        if (!component)
            continue;
        if (Array.isArray(component)) {
            result.push(...component);
        }
        else if (typeof component === 'string' && component) {
            result.push({ role: 'system', content: component });
        }
    }
    return result;
}
// ── Depth Inject ──
/**
 * Insert injection messages at specified depth positions in the chat history.
 * Depth is measured from the end of the messages array.
 */
export function composeDepthInject(messages, injections) {
    if (!injections || injections.length === 0)
        return messages;
    const result = [...messages];
    // Group injections by depth
    const byDepth = new Map();
    for (const inj of injections) {
        const depth = inj.depth ?? 1;
        if (!byDepth.has(depth))
            byDepth.set(depth, []);
        byDepth.get(depth).push({ role: inj.role, content: inj.content });
    }
    // Insert at each depth (from deepest to shallowest to preserve indices)
    const sortedDepths = [...byDepth.keys()].sort((a, b) => b - a);
    for (const depth of sortedDepths) {
        const insertIdx = Math.max(0, result.length - depth);
        result.splice(insertIdx, 0, ...byDepth.get(depth));
    }
    return result;
}
// ── JSON Body Build ──
/**
 * Assemble a FlowRequestV1 compatible JSON body from flow context and config.
 */
export function composeJsonBodyBuild(context, config) {
    return {
        flow_id: context?.request_id ?? `flow_${Date.now()}`,
        chat_id: context?.chat_id ?? '',
        message_id: context?.message_id ?? 0,
        trigger: context?.trigger ?? 'manual',
        timestamp: Date.now(),
        ...(config ?? {}),
    };
}
// ── Request Template ──
/**
 * Apply a mustache-like template to a JSON body.
 * Supports basic {{path.to.value}} replacements with deep path access.
 */
export function composeRequestTemplate(body, template) {
    if (!template)
        return body;
    const rendered = template.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
        const parts = path.trim().split('.');
        let current = body;
        for (const part of parts) {
            if (current == null)
                return '';
            current = current[part];
        }
        return current != null ? String(current) : '';
    });
    const trimmed = rendered.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            return { ...body, ...JSON.parse(trimmed) };
        }
        catch (e) {
            console.debug('[ComposeImpl:request_template] Template produced invalid JSON:', e);
        }
    }
    return { ...body, rendered_template: rendered };
}
//# sourceMappingURL=compose-impls.js.map