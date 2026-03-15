/* ═══ Module Implementations — Source Modules ═══ */
/*
 * Runtime implementations for Source-category modules.
 * These extract data from SillyTavern's runtime environment.
 *
 * NOTE: Iteration 2 stubs. Full implementations will be wired
 * in Iteration 4 when the prompt-assembler functions are refactored
 * to be independently callable.
 */

import type { ModuleOutput } from '../../ui/components/graph/module-types';

/**
 * Collect character card fields from ST runtime.
 * Wraps the logic from prompt-assembler.ts → getRuntimeCharacterFields()
 */
export function collectCharFields(): ModuleOutput {
  try {
    // Attempt to access ST's getCharacterCardFields
    const getter = (globalThis as any).getCharacterCardFields;
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
  } catch (e) {
    console.debug('[ModuleImpl:src_char_fields] Error collecting fields:', e);
  }

  return {
    main: '',
    description: '',
    personality: '',
    scenario: '',
    persona: '',
    examples: '',
    jailbreak: '',
  };
}

/**
 * Collect recent chat messages from ST runtime.
 * Wraps the logic from prompt-assembler.ts chat message collection.
 */
export function collectChatHistory(contextTurns: number): Array<{
  role: 'system' | 'user' | 'assistant';
  content: string;
}> {
  try {
    const getChatMessages = (globalThis as any).getChatMessages;
    if (typeof getChatMessages === 'function') {
      const range = contextTurns > 0 ? `0-${contextTurns * 2}` : '0-16';
      const messages = getChatMessages(range, { quiet: true });
      if (Array.isArray(messages)) {
        return messages
          .filter((msg: any) => msg && typeof msg.content === 'string')
          .map((msg: any) => ({
            role: (msg.role ?? (msg.is_user ? 'user' : 'assistant')) as 'system' | 'user' | 'assistant',
            content: msg.content,
          }));
      }
    }
  } catch (e) {
    console.debug('[ModuleImpl:src_chat_history] Error collecting messages:', e);
  }

  return [];
}
