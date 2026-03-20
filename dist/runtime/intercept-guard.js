import { now, simpleHash } from "./helpers";
const INTERCEPT_TTL_MS = 8000;
let lastIntercept = null;
/**
 * Record that a workflow interception occurred for the given user input.
 * Called by the primary TavernHelper.generate hook so the fallback
 * GENERATION_AFTER_COMMANDS path can skip duplicate processing.
 */
export function markIntercepted(userInput, context) {
    lastIntercept = {
        hash: simpleHash(userInput),
        at: now(),
        message_id: typeof context?.messageId === "number" &&
            Number.isFinite(context.messageId)
            ? Number(context.messageId)
            : null,
        generation_type: String(context?.generationType ?? "").trim(),
    };
}
/**
 * Check whether the given user input was recently intercepted by the
 * primary hook within the TTL window.
 */
export function wasRecentlyIntercepted(userInput, context) {
    if (!lastIntercept) {
        return false;
    }
    if (now() - lastIntercept.at > INTERCEPT_TTL_MS) {
        return false;
    }
    const expectedMessageId = typeof context?.messageId === "number" && Number.isFinite(context.messageId)
        ? Number(context.messageId)
        : null;
    const expectedGenerationType = String(context?.generationType ?? "").trim();
    if (expectedMessageId !== null &&
        lastIntercept.message_id !== null &&
        expectedMessageId === lastIntercept.message_id &&
        expectedGenerationType &&
        expectedGenerationType === lastIntercept.generation_type) {
        return true;
    }
    return simpleHash(userInput) === lastIntercept.hash;
}
/**
 * Reset the intercept guard (e.g. on chat change).
 */
export function resetInterceptGuard() {
    lastIntercept = null;
}
//# sourceMappingURL=intercept-guard.js.map