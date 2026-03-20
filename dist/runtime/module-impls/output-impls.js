/* ═══ Module Implementations — Output Modules ═══ */
/*
 * Runtime implementations for Output-category modules.
 * These persist results, write world book entries, and inject content.
 */
/**
 * Execute world book write operations (upsert/delete/toggle).
 * Delegates to SillyTavern's world info API.
 */
export async function outputWorldbookWrite(operations) {
    if (!operations || operations.length === 0)
        return { success: 0, failed: 0 };
    let success = 0;
    let failed = 0;
    const stContext = globalThis.SillyTavern?.getContext?.();
    if (!stContext)
        return { success: 0, failed: operations.length };
    const worldInfoApi = stContext.worldInfoApi ?? globalThis.worldInfoApi;
    for (const op of operations) {
        try {
            switch (op.action) {
                case 'upsert': {
                    if (worldInfoApi?.upsertEntry) {
                        await worldInfoApi.upsertEntry(op.bookName ?? '', {
                            key: op.entryKey ? [op.entryKey] : [],
                            content: op.content ?? '',
                            ...op.fields,
                        });
                    }
                    success++;
                    break;
                }
                case 'delete': {
                    if (worldInfoApi?.deleteEntry) {
                        await worldInfoApi.deleteEntry(op.bookName ?? '', op.entryKey ?? '');
                    }
                    success++;
                    break;
                }
                case 'toggle': {
                    if (worldInfoApi?.toggleEntry) {
                        await worldInfoApi.toggleEntry(op.bookName ?? '', op.entryKey ?? '');
                    }
                    success++;
                    break;
                }
                default:
                    failed++;
            }
        }
        catch (e) {
            console.debug('[OutputImpl:worldbook_write] Error:', e);
            failed++;
        }
    }
    return { success, failed };
}
// ── Floor Bind ──
/**
 * Bind workflow result data to a chat message's extra data.
 */
export async function outputFloorBind(result, messageId) {
    try {
        const stContext = globalThis.SillyTavern?.getContext?.();
        if (!stContext?.chat)
            return;
        const targetId = messageId ?? stContext.chat.length - 1;
        const message = stContext.chat[targetId];
        if (!message)
            return;
        if (!message.extra)
            message.extra = {};
        message.extra.ew_flow_result = result;
        // Trigger save
        if (typeof stContext.saveChatConditional === 'function') {
            await stContext.saveChatConditional();
        }
    }
    catch (e) {
        console.debug('[OutputImpl:floor_bind] Error:', e);
    }
}
// ── Snapshot Save ──
/**
 * Persist snapshot data to the configured storage mode.
 */
export async function outputSnapshotSave(snapshot, config) {
    try {
        const mode = config.storage_mode ?? 'file';
        if (mode === 'message_data') {
            // Store in current message's extra data
            const stContext = globalThis.SillyTavern?.getContext?.();
            if (stContext?.chat?.length > 0) {
                const lastMsg = stContext.chat[stContext.chat.length - 1];
                if (!lastMsg.extra)
                    lastMsg.extra = {};
                lastMsg.extra.ew_snapshot = snapshot;
                if (typeof stContext.saveChatConditional === 'function') {
                    await stContext.saveChatConditional();
                }
            }
        }
        else {
            // File mode: store via extension API
            const response = await fetch('/api/extensions/ew/snapshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snapshot),
            });
            if (!response.ok) {
                console.warn('[OutputImpl:snapshot_save] Save failed:', response.status);
            }
        }
    }
    catch (e) {
        console.debug('[OutputImpl:snapshot_save] Error:', e);
    }
}
// ── Reply Inject ──
/**
 * Inject instruction text to be prepended to the AI's next reply.
 */
export function outputReplyInject(instruction) {
    if (!instruction)
        return;
    try {
        const stContext = globalThis.SillyTavern?.getContext?.();
        if (stContext) {
            // Use SillyTavern's injection mechanism
            if (typeof stContext.setExtensionPrompt === 'function') {
                stContext.setExtensionPrompt('ew_reply_inject', instruction, 1, // position: IN_CHAT
                0);
            }
        }
    }
    catch (e) {
        console.debug('[OutputImpl:reply_inject] Error:', e);
    }
}
// ── Merge Results ──
/**
 * Merge multiple workflow execution results into a unified plan.
 */
export function outputMergeResults(results) {
    if (!results || results.length === 0)
        return {};
    const merged = {
        merged_at: Date.now(),
        source_count: results.length,
        plans: [],
    };
    for (const result of results) {
        if (result && typeof result === 'object') {
            merged.plans.push(result);
            // Merge world book operations
            if (result.worldbook_ops) {
                if (!merged.worldbook_ops)
                    merged.worldbook_ops = [];
                merged.worldbook_ops.push(...(Array.isArray(result.worldbook_ops) ? result.worldbook_ops : [result.worldbook_ops]));
            }
            // Merge reply injections
            if (result.reply_inject) {
                if (!merged.reply_inject)
                    merged.reply_inject = '';
                merged.reply_inject += '\n' + result.reply_inject;
            }
        }
    }
    return merged;
}
//# sourceMappingURL=output-impls.js.map