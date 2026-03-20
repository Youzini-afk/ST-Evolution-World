/* ═══ Module Implementations — Source Modules ═══ */
/*
 * Runtime implementations for Source-category modules.
 * These extract data from SillyTavern's runtime environment.
 */
/**
 * Collect character card fields from ST runtime.
 */
export function collectCharFields() {
    try {
        const getter = globalThis.getCharacterCardFields;
        if (typeof getter === 'function') {
            const fields = getter();
            return {
                main: fields?.system ?? '',
                description: fields?.description ?? '',
                personality: fields?.personality ?? '',
                scenario: fields?.scenario ?? '',
                persona: fields?.persona ?? '',
                examples: fields?.mesExamples ?? '',
                jailbreak: fields?.jailbreak ?? '',
            };
        }
    }
    catch (e) {
        console.debug('[ModuleImpl:src_char_fields] Error collecting fields:', e);
    }
    return {
        main: '', description: '', personality: '',
        scenario: '', persona: '', examples: '', jailbreak: '',
    };
}
/**
 * Collect recent chat messages from ST runtime.
 */
export function collectChatHistory(contextTurns) {
    try {
        const getChatMessages = globalThis.getChatMessages;
        if (typeof getChatMessages === 'function') {
            const range = contextTurns > 0 ? `0-${contextTurns * 2}` : '0-16';
            const messages = getChatMessages(range, { quiet: true });
            if (Array.isArray(messages)) {
                return messages
                    .filter((msg) => msg && typeof msg.content === 'string')
                    .map((msg) => ({
                    role: (msg.role ?? (msg.is_user ? 'user' : 'assistant')),
                    content: msg.content,
                }));
            }
        }
    }
    catch (e) {
        console.debug('[ModuleImpl:src_chat_history] Error collecting messages:', e);
    }
    return [];
}
/**
 * Collect raw world book entries from character/persona/chat books.
 */
export function collectWorldbookRaw(config) {
    try {
        const stContext = globalThis.SillyTavern?.getContext?.();
        if (!stContext)
            return [];
        const entries = [];
        // Try accessing world info data
        const worldInfo = stContext.worldInfo ?? globalThis.world_info;
        if (Array.isArray(worldInfo)) {
            for (const entry of worldInfo) {
                if (!entry || entry.disable)
                    continue;
                // Filter by source book type
                const source = entry.world ?? entry.source ?? '';
                const isChar = source.includes('character') || source.includes('char');
                const isPersona = source.includes('persona') || source.includes('user');
                const isChat = source.includes('chat');
                const isGlobal = !isChar && !isPersona && !isChat;
                if (isChar && !config.include_character)
                    continue;
                if (isPersona && !config.include_persona)
                    continue;
                if (isChat && !config.include_chat)
                    continue;
                if (isGlobal && !config.include_global)
                    continue;
                entries.push(entry);
            }
            return entries;
        }
    }
    catch (e) {
        console.debug('[ModuleImpl:src_worldbook_raw] Error:', e);
    }
    return [];
}
/**
 * Collect extension prompts from other ST extensions.
 */
export function collectExtensionPrompts() {
    try {
        const stContext = globalThis.SillyTavern?.getContext?.();
        const extPrompts = stContext?.extensionPrompts ?? globalThis.extension_prompts ?? {};
        const before = [];
        const inChat = [];
        const inPrompt = [];
        for (const [_key, value] of Object.entries(extPrompts)) {
            const ep = value;
            if (!ep?.value)
                continue;
            const msg = { role: 'system', content: ep.value };
            const position = ep.position ?? 0;
            if (position === 0) {
                before.push(msg);
            }
            else if (position === 1 || (ep.depth != null && ep.depth > 0)) {
                inChat.push({ ...msg, depth: ep.depth ?? 1 });
            }
            else {
                inPrompt.push(msg);
            }
        }
        return { before_prompt: before, in_chat: inChat, in_prompt: inPrompt };
    }
    catch (e) {
        console.debug('[ModuleImpl:src_extension_prompts] Error:', e);
    }
    return { before_prompt: [], in_chat: [], in_prompt: [] };
}
/**
 * Get flow execution context — chat_id, message_id, trigger info.
 */
export function collectFlowContext(context) {
    return {
        chat_id: context.chatId ?? '',
        message_id: context.messageId ?? 0,
        trigger: context.trigger ?? 'manual',
        request_id: context.requestId ?? '',
        timestamp: Date.now(),
    };
}
/**
 * Collect serial (upstream) workflow results.
 * In serial execution mode, previous workflow results are passed forward.
 */
export function collectSerialResults(previousResults) {
    return Array.isArray(previousResults) ? previousResults : [];
}
//# sourceMappingURL=source-impls.js.map