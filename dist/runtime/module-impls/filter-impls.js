/* ═══ Module Implementations — Filter Modules ═══ */
/*
 * Runtime implementations for Filter-category modules.
 * These process, clean, and filter data flowing through the graph.
 */
// ── MVU Strip ──
/**
 * Strip MVU (Multi-Version Update) XML blocks and artifacts from text.
 * Lazy-imports stripMvuPromptArtifacts from mvu-compat.
 */
export async function filterMvuStrip(text) {
    try {
        const { stripMvuPromptArtifacts } = await import('../mvu-compat');
        return stripMvuPromptArtifacts(text);
    }
    catch {
        // Fallback: basic XML strip
        return text.replace(/<mvu[^>]*>[\s\S]*?<\/mvu>/gi, '').trim();
    }
}
// ── MVU Detect ──
/**
 * Detect whether text contains MVU artifacts.
 * Returns the cleaned text and a boolean flag.
 */
export function filterMvuDetect(text) {
    const mvuPattern = /<mvu[\s>]|<\/mvu>|\[MVU\]|<!-- MVU/i;
    const isMvu = mvuPattern.test(text);
    return { text: isMvu ? '' : text, isMvu };
}
/**
 * Keyword-activate WI entries against a set of chat texts.
 * Implements: constant pass-through, primary key match, secondary key AND/NOT logic.
 */
export function filterWiKeywordMatch(entries, chatTexts) {
    if (!entries || entries.length === 0)
        return [];
    const lowerChat = chatTexts.toLowerCase();
    return entries.filter(entry => {
        if (entry.disable)
            return false;
        // Constant entries always activate
        if (entry.constant)
            return true;
        // Primary key match (any key matches)
        const primaryKeys = entry.key ?? [];
        const primaryMatch = primaryKeys.some(k => k && lowerChat.includes(k.toLowerCase()));
        if (!primaryMatch)
            return false;
        // Secondary key logic
        const secondaryKeys = (entry.keysecondary ?? []).filter(k => k);
        if (secondaryKeys.length === 0)
            return true;
        const logic = entry.selectiveLogic ?? 0;
        const secondaryMatches = secondaryKeys.map(k => lowerChat.includes(k.toLowerCase()));
        switch (logic) {
            case 0: // AND_ANY — at least one secondary matches
                return secondaryMatches.some(Boolean);
            case 1: // NOT_ALL — not all secondaries match
                return !secondaryMatches.every(Boolean);
            case 2: // NOT_ANY — no secondary matches
                return !secondaryMatches.some(Boolean);
            case 3: // AND_ALL — all secondaries match
                return secondaryMatches.every(Boolean);
            default:
                return true;
        }
    });
}
// ── WI Probability Filter ──
/**
 * Filter entries by probability. Entries with probability < 100 are
 * randomly activated based on their probability value.
 */
export function filterWiProbability(entries) {
    return entries.filter(entry => {
        const prob = entry.probability ?? 100;
        if (prob >= 100)
            return true;
        if (prob <= 0)
            return false;
        return Math.random() * 100 < prob;
    });
}
// ── WI Mutex Group ──
/**
 * For entries sharing a mutex group, keep only the highest-order one.
 */
export function filterWiMutexGroup(entries) {
    const groups = new Map();
    const result = [];
    for (const entry of entries) {
        const group = entry.group;
        if (!group) {
            result.push(entry);
            continue;
        }
        const existing = groups.get(group);
        if (!existing || (entry.order ?? 0) > (existing.order ?? 0)) {
            groups.set(group, entry);
        }
    }
    // Add the winners
    for (const entry of groups.values()) {
        result.push(entry);
    }
    return result;
}
// ── Blocked Content Strip ──
/**
 * Remove blocked WI entry content from text via substring matching.
 */
export function filterBlockedContentStrip(text, blockedEntries) {
    if (!blockedEntries || blockedEntries.length === 0)
        return text;
    let result = text;
    for (const entry of blockedEntries) {
        if (entry.content && result.includes(entry.content)) {
            result = result.split(entry.content).join('');
        }
    }
    return result.trim();
}
// ── Regex Process (ST built-in regexes) ──
/**
 * Apply SillyTavern's built-in regex processing rules.
 * This is a stub that returns text unmodified — actual ST regex
 * system is applied at the framework level.
 */
export function filterRegexProcess(text) {
    try {
        const stContext = globalThis.SillyTavern?.getContext?.();
        const runRegex = stContext?.runRegexScript;
        if (typeof runRegex === 'function') {
            return runRegex(text) ?? text;
        }
    }
    catch { /* no-op */ }
    return text;
}
/**
 * Extract messages matching any of the provided regex patterns.
 */
export function filterContextExtract(messages, rules) {
    if (!rules || rules.length === 0)
        return messages;
    const regexes = rules
        .filter(r => r.pattern)
        .map(r => {
        try {
            return new RegExp(r.pattern, r.flags ?? 'i');
        }
        catch {
            return null;
        }
    })
        .filter(Boolean);
    if (regexes.length === 0)
        return messages;
    return messages.filter(msg => regexes.some(rx => rx.test(msg.content)));
}
// ── Context Exclude ──
/**
 * Exclude messages matching any of the provided regex patterns.
 */
export function filterContextExclude(messages, rules) {
    if (!rules || rules.length === 0)
        return messages;
    const regexes = rules
        .filter(r => r.pattern)
        .map(r => {
        try {
            return new RegExp(r.pattern, r.flags ?? 'i');
        }
        catch {
            return null;
        }
    })
        .filter(Boolean);
    if (regexes.length === 0)
        return messages;
    return messages.filter(msg => !regexes.some(rx => rx.test(msg.content)));
}
// ── Custom Regex Replace ──
/**
 * Apply user-defined find/replace regex rules to text.
 */
export function filterCustomRegex(text, rules) {
    if (!rules || rules.length === 0)
        return text;
    let result = text;
    for (const rule of rules) {
        if (!rule.find)
            continue;
        try {
            const rx = new RegExp(rule.find, rule.flags ?? 'g');
            result = result.replace(rx, rule.replace ?? '');
        }
        catch {
            console.debug(`[FilterImpl:custom_regex] Invalid regex: ${rule.find}`);
        }
    }
    return result;
}
// ── Hide Messages ──
/**
 * Hide last N messages and/or apply limiter threshold.
 */
export function filterHideMessages(messages, config) {
    let result = [...messages];
    // Limiter: keep only the most recent N messages
    if (config.limiter_enabled && config.limiter_count && config.limiter_count > 0) {
        if (result.length > config.limiter_count) {
            result = result.slice(-config.limiter_count);
        }
    }
    // Hide last N
    const hideN = config.hide_last_n ?? 0;
    if (hideN > 0 && result.length > hideN) {
        result = result.slice(0, -hideN);
    }
    return result;
}
//# sourceMappingURL=filter-impls.js.map