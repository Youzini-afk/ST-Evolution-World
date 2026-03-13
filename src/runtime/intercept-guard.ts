import { simpleHash, now } from './helpers';

type InterceptRecord = {
  hash: string;
  at: number;
};

const INTERCEPT_TTL_MS = 8000;

let lastIntercept: InterceptRecord | null = null;

/**
 * Record that a workflow interception occurred for the given user input.
 * Called by the primary TavernHelper.generate hook so the fallback
 * GENERATION_AFTER_COMMANDS path can skip duplicate processing.
 */
export function markIntercepted(userInput: string): void {
  lastIntercept = {
    hash: simpleHash(userInput),
    at: now(),
  };
}

/**
 * Check whether the given user input was recently intercepted by the
 * primary hook within the TTL window.
 */
export function wasRecentlyIntercepted(userInput: string): boolean {
  if (!lastIntercept) {
    return false;
  }
  if (now() - lastIntercept.at > INTERCEPT_TTL_MS) {
    return false;
  }
  return simpleHash(userInput) === lastIntercept.hash;
}

/**
 * Reset the intercept guard (e.g. on chat change).
 */
export function resetInterceptGuard(): void {
  lastIntercept = null;
}
