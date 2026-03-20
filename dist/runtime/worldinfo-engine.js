/**
 * World Info Engine – self-contained worldbook activation and EJS rendering.
 *
 * Replicates SillyTavern's worldbook activation logic:
 *  - Constant (🔵) entries
 *  - Decorator-based activation (@@activate, @@dont_activate, @@only_preload)
 *  - Primary keyword matching (regex, case-sensitive, whole-word)
 *  - Secondary keyword (blue lamp) logic: AND_ANY, AND_ALL, NOT_ANY, NOT_ALL
 *  - Probability filtering
 *  - Inclusion group handling (priority, scoring, weighted random)
 *  - Position classification (before/after char defs, at depth, etc.)
 *  - substituteParams macro replacement in keywords
 *  - Special entry name detection ([GENERATE:], [RENDER:], @INJECT, etc.)
 *
 * Used exclusively for workflow prompt assembly.
 */
import { getSillyTavernContext } from "./compat/generation";
import { getCharWorldbookNames, getLorebookEntries, getWorldbook, } from "./compat/worldbook";
import { createRenderContext, evalEjsTemplate } from "./ejs-internal";
import { simpleHash } from "./helpers";
import { isLikelyMvuWorldInfoContent, isMvuTaggedWorldInfoNameOrComment, } from "./mvu-compat";
// ---------------------------------------------------------------------------
// ST Constants (replicated locally to avoid import dependency)
// ---------------------------------------------------------------------------
/** ST world_info_position enum values */
const WI_POSITION = {
    before: 0, // Before Char Defs
    after: 1, // After Char Defs
    EMTop: 2, // Before Example Messages
    EMBottom: 3, // After Example Messages
    ANTop: 4, // Top of Author's Note
    ANBottom: 5, // Bottom of Author's Note
    atDepth: 6, // @ D (at specified depth in chat)
};
/** ST world_info_logic enum values (selectiveLogic) */
const WI_LOGIC = {
    AND_ANY: 0, // Primary + Any secondary
    NOT_ALL: 1, // Primary + NOT all secondary
    NOT_ANY: 2, // Primary + NONE of the secondary
    AND_ALL: 3, // Primary + ALL secondary
};
/** Depth mapping for sorting (mirrors ST's DEPTH_MAPPING) */
const DEPTH_MAPPING = {
    [WI_POSITION.before]: 4, // Before Char Defs
    [WI_POSITION.after]: 3, // After Char Defs
    [WI_POSITION.EMTop]: 2, // Before Example Messages
    [WI_POSITION.EMBottom]: 1, // After Example Messages
    [WI_POSITION.ANTop]: 1, // Top of Author's Note
    [WI_POSITION.ANBottom]: -1, // Bottom of Author's Note
};
const DEFAULT_DEPTH = 4;
// ---------------------------------------------------------------------------
// ST Runtime Accessors — now from compat layer
// (inline declare statements removed; getWorldbook, getCharWorldbookNames, getLorebookEntries imported from compat/worldbook)
function getStContext() {
    try {
        return getSillyTavernContext() ?? {};
    }
    catch {
        return {};
    }
}
// ---------------------------------------------------------------------------
// substituteParams – macro replacement for keywords (Fix #1)
// ---------------------------------------------------------------------------
/**
 * Replace common ST macros in keyword strings before matching.
 * Mirrors SillyTavern's `substituteParams()` for the most common macros.
 */
function substituteParams(text) {
    if (!text || !text.includes("{{"))
        return text;
    const ctx = getStContext();
    const userName = ctx.name1 ?? "";
    const charName = ctx.name2 ?? "";
    const personaDescription = ctx.persona ?? "";
    return text
        .replace(/\{\{user\}\}/gi, userName)
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/\{\{persona\}\}/gi, personaDescription)
        .replace(/\{\{original\}\}/gi, "")
        .replace(/\{\{input\}\}/gi, "")
        .replace(/\{\{lastMessage\}\}/gi, "")
        .replace(/\{\{lastMessageId\}\}/gi, "")
        .replace(/\{\{newline\}\}/gi, "\n")
        .replace(/\{\{trim\}\}/gi, "");
}
// ---------------------------------------------------------------------------
// Decorator Parsing (Fix #5: separate name from arguments)
// ---------------------------------------------------------------------------
const KNOWN_DECORATORS = [
    "@@activate",
    "@@dont_activate",
    "@@message_formatting",
    "@@generate_before",
    "@@generate_after",
    "@@render_before",
    "@@render_after",
    "@@dont_preload",
    "@@initial_variables",
    "@@always_enabled",
    "@@only_preload",
    "@@iframe",
    "@@preprocessing",
    "@@if",
    "@@private",
];
function parseDecorators(content) {
    const decorators = [];
    const lines = content.split("\n");
    const cleanLines = [];
    for (const line of lines) {
        const trimmed = line.trim();
        const match = KNOWN_DECORATORS.find((d) => trimmed.startsWith(d));
        if (match) {
            // ST separates decorator name from arguments — store only the name
            const firstSpace = trimmed.indexOf(" ");
            decorators.push(firstSpace > 0 ? trimmed.substring(0, firstSpace) : trimmed);
        }
        else {
            cleanLines.push(line);
        }
    }
    return {
        decorators,
        cleanContent: cleanLines.join("\n").trim(),
    };
}
// ---------------------------------------------------------------------------
// Special Entry Name Detection (Fix #6)
// ---------------------------------------------------------------------------
const SPECIAL_NAME_MARKERS = [
    "[GENERATE:",
    "[RENDER:",
    "@INJECT",
    "[InitialVariables]",
];
function isSpecialEntryByComment(comment) {
    return SPECIAL_NAME_MARKERS.some((marker) => comment.includes(marker));
}
// ---------------------------------------------------------------------------
// Entry Normalization (Fix #4: handle both `disable` and `enabled`)
// ---------------------------------------------------------------------------
function normalizeEntry(raw, worldbookName) {
    const { decorators, cleanContent } = parseDecorators(raw.content);
    // Map position.type string to numeric position
    let position = WI_POSITION.atDepth;
    const posType = raw.position?.type ?? "at_depth";
    let resolvedRole = raw.position?.role ?? "system";
    if (posType === "before_char" ||
        posType === "before" ||
        posType === "before_character_definition")
        position = WI_POSITION.before;
    else if (posType === "after_char" ||
        posType === "after" ||
        posType === "after_character_definition")
        position = WI_POSITION.after;
    else if (posType === "em_top" || posType === "before_example_messages")
        position = WI_POSITION.EMTop;
    else if (posType === "em_bottom" || posType === "after_example_messages")
        position = WI_POSITION.EMBottom;
    else if (posType === "an_top" || posType === "before_author_note")
        position = WI_POSITION.ANTop;
    else if (posType === "an_bottom" || posType === "after_author_note")
        position = WI_POSITION.ANBottom;
    else if (posType === "at_depth" || posType === "at_depth_as_system")
        position = WI_POSITION.atDepth;
    else if (posType === "at_depth_as_assistant") {
        position = WI_POSITION.atDepth;
        resolvedRole = "assistant";
    }
    else if (posType === "at_depth_as_user") {
        position = WI_POSITION.atDepth;
        resolvedRole = "user";
    }
    // numeric position from extensions (legacy support)
    else if (typeof raw.extensions?.position === "number") {
        position = raw.extensions.position;
    }
    // Map strategy.type to boolean flags
    const isConstant = raw.strategy?.type === "constant";
    const isSelective = raw.strategy?.type === "selective";
    // selectiveLogic from keys_secondary
    let selectiveLogic = WI_LOGIC.AND_ANY;
    const logicStr = raw.strategy?.keys_secondary?.logic;
    if (logicStr === "not_all")
        selectiveLogic = WI_LOGIC.NOT_ALL;
    else if (logicStr === "not_any")
        selectiveLogic = WI_LOGIC.NOT_ANY;
    else if (logicStr === "and_all")
        selectiveLogic = WI_LOGIC.AND_ALL;
    // Fix #4: handle both `disable` (ST native) and `enabled` (getWorldbook API)
    let isEnabled;
    if (typeof raw.disable === "boolean") {
        isEnabled = !raw.disable;
    }
    else if (typeof raw.enabled === "boolean") {
        isEnabled = raw.enabled;
    }
    else {
        isEnabled = true; // default: enabled
    }
    return {
        uid: raw.uid,
        name: raw.name,
        comment: String(raw.comment ?? ""),
        content: raw.content,
        cleanContent,
        decorators,
        enabled: isEnabled,
        worldbook: worldbookName,
        constant: isConstant,
        selective: isSelective,
        keys: raw.strategy?.keys ?? [],
        keysSecondary: raw.strategy?.keys_secondary?.keys ?? [],
        selectiveLogic,
        useProbability: raw.probability !== undefined && raw.probability < 100,
        probability: raw.probability ?? 100,
        caseSensitive: raw.extra?.caseSensitive ?? false,
        matchWholeWords: raw.extra?.matchWholeWords ?? false,
        group: raw.extra?.group ?? "",
        groupOverride: raw.extra?.groupOverride ?? false,
        groupWeight: raw.extra?.groupWeight ?? 100,
        useGroupScoring: raw.extra?.useGroupScoring ?? false,
        position,
        depth: raw.position?.depth ?? 0,
        order: raw.position?.order ?? 100,
        role: resolvedRole,
    };
}
function shouldIgnoreForWorkflow(entry) {
    return (isMvuTaggedWorldInfoNameOrComment(entry.name, entry.comment) ||
        isLikelyMvuWorldInfoContent(entry.cleanContent || entry.content));
}
// ---------------------------------------------------------------------------
// Keyword Matching
// ---------------------------------------------------------------------------
function parseRegexFromString(input) {
    const match = /^\/(.*?)\/([gimsuy]*)$/.exec(input);
    if (!match)
        return null;
    try {
        return new RegExp(match[1], match[2]);
    }
    catch {
        return null;
    }
}
function deterministicPercent(seed) {
    const hashed = simpleHash(seed).replace(/^h/, "");
    const parsed = Number.parseInt(hashed.slice(0, 8), 16);
    if (!Number.isFinite(parsed)) {
        return 100;
    }
    return (parsed % 100) + 1;
}
function deterministicWeightedIndex(weights, seed) {
    const normalized = weights.map((weight) => Math.max(0, Math.trunc(Number(weight) || 0)));
    const totalWeight = _.sum(normalized);
    if (totalWeight <= 0) {
        return -1;
    }
    const hashed = simpleHash(seed).replace(/^h/, "");
    let rollValue = (Number.parseInt(hashed.slice(0, 8), 16) % totalWeight) + 1;
    for (let i = 0; i < normalized.length; i += 1) {
        rollValue -= normalized[i];
        if (rollValue <= 0) {
            return i;
        }
    }
    return normalized.length - 1;
}
function matchKeys(haystack, needle, entry) {
    // Regex keyword
    const keyRegex = parseRegexFromString(needle.trim());
    if (keyRegex) {
        return keyRegex.test(haystack);
    }
    const transformedHaystack = entry.caseSensitive
        ? haystack
        : haystack.toLowerCase();
    const transformedNeedle = entry.caseSensitive
        ? needle.trim()
        : needle.trim().toLowerCase();
    if (!transformedNeedle)
        return false;
    if (entry.matchWholeWords) {
        const keyWords = transformedNeedle.split(/\s+/);
        if (keyWords.length > 1) {
            return transformedHaystack.includes(transformedNeedle);
        }
        const regex = new RegExp(`(?:^|\\W)(${_.escapeRegExp(transformedNeedle)})(?:$|\\W)`);
        return regex.test(transformedHaystack);
    }
    return transformedHaystack.includes(transformedNeedle);
}
// ---------------------------------------------------------------------------
// Group Scoring
// ---------------------------------------------------------------------------
function getScore(trigger, entry) {
    let primaryScore = 0;
    let secondaryScore = 0;
    for (const key of entry.keys) {
        if (matchKeys(trigger, key, entry))
            primaryScore++;
    }
    for (const key of entry.keysSecondary) {
        if (matchKeys(trigger, key, entry))
            secondaryScore++;
    }
    if (entry.keys.length === 0)
        return 0;
    if (entry.keysSecondary.length > 0) {
        if (entry.selectiveLogic === WI_LOGIC.AND_ANY)
            return primaryScore + secondaryScore;
        if (entry.selectiveLogic === WI_LOGIC.AND_ALL) {
            return secondaryScore === entry.keysSecondary.length
                ? primaryScore + secondaryScore
                : primaryScore;
        }
    }
    return primaryScore;
}
// ---------------------------------------------------------------------------
// Entry Activation (replicates ST selectActivatedEntries)
// Fixes applied: #1 substituteParams, #5 exact decorator match, #6 special names
// ---------------------------------------------------------------------------
function selectActivatedEntries(entries, trigger) {
    const activationSeedBase = _.escapeRegExp(String(trigger ?? ""));
    const activated = new Set();
    for (const entry of entries) {
        if (!entry.enabled)
            continue;
        // Probability check
        if (entry.useProbability) {
            const probabilityRoll = deterministicPercent(`${activationSeedBase}:prob:${entry.worldbook}:${entry.uid}:${entry.name}`);
            if (entry.probability < probabilityRoll)
                continue;
        }
        // 🔵 Constant — always activated
        if (entry.constant) {
            activated.add(entry);
            continue;
        }
        // Decorator-based activation (Fix #5: exact match, not startsWith)
        if (entry.decorators.includes("@@activate")) {
            activated.add(entry);
            continue;
        }
        if (entry.decorators.includes("@@dont_activate"))
            continue;
        if (entry.decorators.includes("@@only_preload"))
            continue;
        // Special decorator entries (@@generate, @@render, @@initial_variables, @@preprocessing, @@iframe)
        const specialDecorators = [
            "@@generate",
            "@@generate_before",
            "@@generate_after",
            "@@render",
            "@@render_before",
            "@@render_after",
            "@@initial_variables",
            "@@preprocessing",
            "@@iframe",
        ];
        if (entry.decorators.some((d) => specialDecorators.includes(d)))
            continue;
        // Fix #6: Special entry name markers
        if (isSpecialEntryByComment(entry.comment))
            continue;
        // Primary keyword matching (Fix #1: substituteParams before match)
        if (entry.keys.length === 0)
            continue;
        const matchedKey = entry.keys
            .map((k) => substituteParams(k))
            .find((k) => matchKeys(trigger, k, entry));
        if (!matchedKey)
            continue;
        // Secondary keyword (blue lamp) logic
        const hasSecondaryKeys = entry.selective && entry.keysSecondary.length > 0;
        if (!hasSecondaryKeys) {
            activated.add(entry);
            continue;
        }
        let hasAnyMatch = false;
        let hasAllMatch = true;
        for (const secondary of entry.keysSecondary) {
            // Fix #1: substituteParams on secondary keys too
            const substituted = substituteParams(secondary);
            const hasMatch = substituted.trim() !== "" &&
                matchKeys(trigger, substituted.trim(), entry);
            if (hasMatch)
                hasAnyMatch = true;
            if (!hasMatch)
                hasAllMatch = false;
            // AND_ANY: primary + any one secondary
            if (entry.selectiveLogic === WI_LOGIC.AND_ANY && hasMatch) {
                activated.add(entry);
                break;
            }
            // NOT_ALL: primary + NOT all secondary present
            if (entry.selectiveLogic === WI_LOGIC.NOT_ALL && !hasMatch) {
                activated.add(entry);
                break;
            }
        }
        // NOT_ANY: primary + none of secondary
        if (entry.selectiveLogic === WI_LOGIC.NOT_ANY && !hasAnyMatch) {
            activated.add(entry);
            continue;
        }
        // AND_ALL: primary + all secondary
        if (entry.selectiveLogic === WI_LOGIC.AND_ALL && hasAllMatch) {
            activated.add(entry);
            continue;
        }
    }
    if (activated.size === 0)
        return [];
    // ── Inclusion Group handling ──
    const grouped = _.groupBy(Array.from(activated), (e) => e.group);
    const ungrouped = grouped[""] ?? [];
    if (ungrouped.length > 0 && Object.keys(grouped).length <= 1) {
        return ungrouped.sort(sortEntries);
    }
    const matched = [];
    for (const [group, members] of Object.entries(grouped)) {
        if (group === "")
            continue;
        if (members.length === 1) {
            matched.push(members[0]);
            continue;
        }
        // Group prioritization
        const usePrioritize = members.filter((e) => e.groupOverride);
        if (usePrioritize.length > 0) {
            const orders = usePrioritize.map((e) => e.order);
            if (orders.length > 0) {
                const top = Math.min(...orders);
                matched.push(usePrioritize[Math.max(usePrioritize.findIndex((entry) => entry.order <= top), 0)]);
                continue;
            }
        }
        // Group scoring
        const useScoring = members.filter((e) => e.useGroupScoring);
        if (useScoring.length > 0) {
            const scores = members.map((e) => getScore(trigger, e));
            const top = Math.max(...scores);
            if (top > 0) {
                matched.push(members[Math.max(scores.findIndex((s) => s >= top), 0)]);
                continue;
            }
        }
        // Fix #7: Weighted random — only for members without groupOverride or useGroupScoring
        const useWeights = members.filter((e) => !e.groupOverride && !e.useGroupScoring);
        if (useWeights.length > 0) {
            const weights = useWeights.map((e) => e.groupWeight);
            const winner = deterministicWeightedIndex(weights, `${activationSeedBase}:group:${group}:${useWeights.map((entry) => `${entry.worldbook}:${entry.uid}`).join("|")}`);
            if (winner >= 0)
                matched.push(useWeights[winner]);
        }
    }
    return ungrouped.concat(matched).sort(sortEntries);
}
// Fix #3: Sort with depth dimension, matching ST's worldInfoSorter
function calcDepth(entry, maxDepth) {
    const offset = DEPTH_MAPPING[entry.position];
    // atDepth: absolute depth
    if (offset == null) {
        return entry.depth ?? DEFAULT_DEPTH;
    }
    // relative to chat history with preset offset
    return offset + maxDepth;
}
function sortEntries(a, b) {
    // Compute max depth among all atDepth entries for relative sorting
    const maxDepth = Math.max(a.depth, b.depth, DEFAULT_DEPTH);
    // Sort by depth (desc), then order (asc), then uid (desc) — matches ST
    return (calcDepth(b, maxDepth) - calcDepth(a, maxDepth) ||
        a.order - b.order ||
        b.uid - a.uid);
}
// ---------------------------------------------------------------------------
// Worldbook Collection (Fix #2: add persona + chat-bound lorebooks)
// ---------------------------------------------------------------------------
async function collectAllWorldbookEntries() {
    const allEntries = [];
    // Helper to load and normalize entries from a worldbook
    async function loadWb(wbName) {
        try {
            const entries = await getWorldbook(wbName);
            let commentByUid = new Map();
            try {
                const lorebookEntries = await getLorebookEntries(wbName);
                commentByUid = new Map(lorebookEntries.map((entry) => [
                    entry.uid,
                    String(entry.comment ?? ""),
                ]));
            }
            catch (commentError) {
                console.debug(`[EW WI Engine] Cannot read lorebook comments for '${wbName}':`, commentError);
            }
            for (const entry of entries) {
                const normalized = normalizeEntry({
                    ...entry,
                    comment: commentByUid.get(entry.uid) ?? entry.comment ?? "",
                }, wbName);
                if (shouldIgnoreForWorkflow(normalized)) {
                    continue;
                }
                allEntries.push(normalized);
            }
        }
        catch (e) {
            console.debug(`[EW WI Engine] Cannot read worldbook '${wbName}':`, e);
        }
    }
    const loadedNames = new Set();
    async function loadWbOnce(wbName) {
        if (!wbName || loadedNames.has(wbName))
            return;
        loadedNames.add(wbName);
        await loadWb(wbName);
    }
    // 1. Character primary worldbook
    try {
        const charWb = getCharWorldbookNames();
        if (charWb.primary) {
            await loadWbOnce(charWb.primary);
        }
        // Character additional worldbooks
        for (const additionalWb of charWb.additional ?? []) {
            await loadWbOnce(additionalWb);
        }
    }
    catch (e) {
        console.debug("[EW WI Engine] Cannot read character worldbooks:", e);
    }
    // 2. Fix #2: Persona lorebook
    try {
        const ctx = getStContext();
        const personaLorebook = ctx.extensionSettings?.persona_description_lorebook ??
            ctx.power_user?.persona_description_lorebook;
        if (personaLorebook) {
            await loadWbOnce(personaLorebook);
        }
    }
    catch (e) {
        console.debug("[EW WI Engine] Cannot read persona lorebook:", e);
    }
    // 3. Fix #2: Chat-bound lorebook (chat_metadata['world'])
    try {
        const ctx = getStContext();
        const chatWorld = ctx.chatMetadata?.world;
        if (chatWorld) {
            await loadWbOnce(chatWorld);
        }
    }
    catch (e) {
        console.debug("[EW WI Engine] Cannot read chat-bound lorebook:", e);
    }
    return allEntries;
}
export async function collectIgnoredWorldInfoContents() {
    const ignoredContents = [];
    async function loadWb(wbName) {
        try {
            const entries = await getWorldbook(wbName);
            let commentByUid = new Map();
            try {
                const lorebookEntries = await getLorebookEntries(wbName);
                commentByUid = new Map(lorebookEntries.map((entry) => [
                    entry.uid,
                    String(entry.comment ?? ""),
                ]));
            }
            catch (commentError) {
                console.debug(`[EW WI Engine] Cannot read lorebook comments for '${wbName}':`, commentError);
            }
            for (const entry of entries) {
                const normalized = normalizeEntry({
                    ...entry,
                    comment: commentByUid.get(entry.uid) ?? entry.comment ?? "",
                }, wbName);
                if (!shouldIgnoreForWorkflow(normalized)) {
                    continue;
                }
                const normalizedContent = (normalized.cleanContent || normalized.content).trim();
                if (normalizedContent) {
                    ignoredContents.push(normalizedContent);
                }
            }
        }
        catch (e) {
            console.debug(`[EW WI Engine] Cannot read worldbook '${wbName}' for ignore list:`, e);
        }
    }
    const loadedNames = new Set();
    async function loadWbOnce(wbName) {
        if (!wbName || loadedNames.has(wbName))
            return;
        loadedNames.add(wbName);
        await loadWb(wbName);
    }
    try {
        const charWb = getCharWorldbookNames();
        if (charWb.primary) {
            await loadWbOnce(charWb.primary);
        }
        for (const additionalWb of charWb.additional ?? []) {
            await loadWbOnce(additionalWb);
        }
    }
    catch (e) {
        console.debug("[EW WI Engine] Cannot read character worldbooks for ignore list:", e);
    }
    try {
        const ctx = getStContext();
        const personaLorebook = ctx.extensionSettings?.persona_description_lorebook ??
            ctx.power_user?.persona_description_lorebook;
        if (personaLorebook) {
            await loadWbOnce(personaLorebook);
        }
    }
    catch (e) {
        console.debug("[EW WI Engine] Cannot read persona lorebook for ignore list:", e);
    }
    try {
        const ctx = getStContext();
        const chatWorld = ctx.chatMetadata?.world;
        if (chatWorld) {
            await loadWbOnce(chatWorld);
        }
    }
    catch (e) {
        console.debug("[EW WI Engine] Cannot read chat-bound lorebook for ignore list:", e);
    }
    return _.uniq(ignoredContents.map((content) => content.trim()).filter(Boolean));
}
// ---------------------------------------------------------------------------
// Position Classification
// ---------------------------------------------------------------------------
function classifyPosition(entry) {
    switch (entry.position) {
        case WI_POSITION.before:
        case WI_POSITION.EMTop:
        case WI_POSITION.ANTop:
            return "before";
        case WI_POSITION.atDepth:
            return "atDepth";
        case WI_POSITION.after:
        case WI_POSITION.EMBottom:
        case WI_POSITION.ANBottom:
        default:
            return "after";
    }
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Resolve all active worldbook entries for the current context.
 *
 * 1. Collects entries from request-scoped worldbooks (char, persona, chat-bound)
 * 2. Runs ST-compatible activation logic (keywords, constants, decorators, groups)
 * 3. Executes EJS rendering on activated entries
 * 4. Returns structured before/after lists with entry names
 */
export async function resolveWorldInfo(_settings, chatMessages) {
    const result = { before: [], after: [], atDepth: [] };
    const roleMap = {
        system: "system",
        user: "user",
        assistant: "assistant",
    };
    try {
        // 1. Collect all entries
        const allEntries = await collectAllWorldbookEntries();
        if (allEntries.length === 0)
            return result;
        // 2. Build activation trigger from chat messages
        const trigger = chatMessages.join("\n\n");
        // 3. Run activation logic
        const activated = selectActivatedEntries(allEntries, trigger);
        if (activated.length === 0)
            return result;
        // 4. Build render context (for EJS getwi calls)
        const allForGetwi = allEntries.map((e) => ({
            name: e.name,
            comment: e.comment,
            content: e.cleanContent || e.content,
            worldbook: e.worldbook,
        }));
        const renderCtx = createRenderContext(allForGetwi);
        // 5. Render each activated entry and classify by position
        for (const entry of activated) {
            const contentToRender = entry.cleanContent || entry.content;
            let rendered;
            renderCtx.pulledEntries.clear();
            try {
                rendered = await evalEjsTemplate(contentToRender, renderCtx, {
                    world_info: {
                        comment: entry.comment || entry.name,
                        name: entry.name,
                        world: entry.worldbook,
                    },
                });
            }
            catch (e) {
                console.warn(`[EW WI Engine] EJS render failed for entry '${entry.name}':`, e);
                rendered = contentToRender;
            }
            // Skip empty entries after rendering
            if (!rendered.trim())
                continue;
            const bucket = classifyPosition(entry);
            const targetBucket = result[bucket];
            if (entry.name.startsWith(_settings.controller_entry_prefix)) {
                const rawControllerEntry = {
                    name: entry.name,
                    source_name: entry.name,
                    content: contentToRender,
                    role: roleMap[entry.role] ?? "system",
                    position: entry.position,
                    depth: entry.depth,
                    order: entry.order,
                };
                targetBucket.push(rawControllerEntry);
                for (const pulled of renderCtx.pulledEntries.values()) {
                    if (!pulled.content.trim())
                        continue;
                    if (pulled.worldbook === entry.worldbook &&
                        pulled.name === entry.name)
                        continue;
                    targetBucket.push({
                        name: pulled.comment || pulled.name,
                        source_name: pulled.name,
                        content: pulled.content,
                        role: roleMap[entry.role] ?? "system",
                        position: entry.position,
                        depth: entry.depth,
                        order: entry.order,
                    });
                }
                continue;
            }
            const resolvedEntry = {
                name: entry.name,
                content: rendered,
                role: roleMap[entry.role] ?? "system",
                position: entry.position,
                depth: entry.depth,
                order: entry.order,
            };
            targetBucket.push(resolvedEntry);
        }
    }
    catch (e) {
        console.error("[EW WI Engine] resolveWorldInfo failed:", e);
    }
    return result;
}
//# sourceMappingURL=worldinfo-engine.js.map