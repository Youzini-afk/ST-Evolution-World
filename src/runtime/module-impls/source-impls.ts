/* ═══ Module Implementations — Source Modules ═══ */
/*
 * Runtime implementations for Source-category modules.
 * These extract data from SillyTavern's runtime environment.
 */

import type { ModuleOutput } from "../../ui/components/graph/module-types";

/**
 * Collect character card fields from ST runtime.
 */
export function collectCharFields(): ModuleOutput {
  try {
    const getter = (globalThis as any).getCharacterCardFields;
    if (typeof getter === "function") {
      const fields = getter();
      return {
        main: fields?.system ?? "",
        description: fields?.description ?? "",
        personality: fields?.personality ?? "",
        scenario: fields?.scenario ?? "",
        persona: fields?.persona ?? "",
        examples: fields?.mesExamples ?? "",
        jailbreak: fields?.jailbreak ?? "",
      };
    }
  } catch (e) {
    console.debug("[ModuleImpl:src_char_fields] Error collecting fields:", e);
  }

  return {
    main: "",
    description: "",
    personality: "",
    scenario: "",
    persona: "",
    examples: "",
    jailbreak: "",
  };
}

/**
 * Collect recent chat messages from ST runtime.
 */
export function collectChatHistory(contextTurns: number): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  try {
    const getChatMessages = (globalThis as any).getChatMessages;
    if (typeof getChatMessages === "function") {
      const safeTurns = Number.isFinite(contextTurns)
        ? Math.max(0, Math.floor(contextTurns))
        : 8;
      const maxMessages = safeTurns > 0 ? safeTurns * 2 : 16;
      const range = `0-${maxMessages}`;
      const messages = getChatMessages(range, { quiet: true });
      if (Array.isArray(messages)) {
        return messages
          .filter((msg: any) => msg && typeof msg.content === "string")
          .map((msg: any) => {
            const role =
              msg.role === "system" ||
              msg.role === "user" ||
              msg.role === "assistant"
                ? msg.role
                : msg.is_user
                  ? "user"
                  : "assistant";
            return {
              role,
              content: msg.content,
            };
          });
      }

      const stContext = (globalThis as any).SillyTavern?.getContext?.();
      if (Array.isArray(stContext?.chat)) {
        return stContext.chat
          .slice(-maxMessages)
          .filter((msg: any) => msg && typeof msg.mes === "string")
          .map((msg: any) => ({
            role: msg.is_system ? "system" : msg.is_user ? "user" : "assistant",
            content: msg.mes,
          }));
      }
    }
  } catch (e) {
    console.debug(
      "[ModuleImpl:src_chat_history] Error collecting messages:",
      e,
    );
  }

  return [];
}

/**
 * Collect raw world book entries from character/persona/chat books.
 */
export function collectWorldbookRaw(config: {
  include_character?: boolean;
  include_persona?: boolean;
  include_chat?: boolean;
  include_global?: boolean;
}): any[] {
  try {
    const stContext = (globalThis as any).SillyTavern?.getContext?.();
    if (!stContext) return [];

    const entries: any[] = [];

    // Try accessing world info data
    const worldInfo = stContext.worldInfo ?? (globalThis as any).world_info;
    if (Array.isArray(worldInfo)) {
      for (const entry of worldInfo) {
        if (!entry || entry.disable) continue;

        // Filter by source book type
        const source = entry.world ?? entry.source ?? "";
        const isChar = source.includes("character") || source.includes("char");
        const isPersona = source.includes("persona") || source.includes("user");
        const isChat = source.includes("chat");
        const isGlobal = !isChar && !isPersona && !isChat;

        if (isChar && !config.include_character) continue;
        if (isPersona && !config.include_persona) continue;
        if (isChat && !config.include_chat) continue;
        if (isGlobal && !config.include_global) continue;

        entries.push(entry);
      }
      return entries;
    }
  } catch (e) {
    console.debug("[ModuleImpl:src_worldbook_raw] Error:", e);
  }

  return [];
}

/**
 * Collect extension prompts from other ST extensions.
 */
export function collectExtensionPrompts(): {
  before_prompt: any[];
  in_chat: any[];
  in_prompt: any[];
} {
  try {
    const stContext = (globalThis as any).SillyTavern?.getContext?.();
    const extPrompts =
      stContext?.extensionPrompts ??
      (globalThis as any).extension_prompts ??
      {};

    const before: any[] = [];
    const inChat: any[] = [];
    const inPrompt: any[] = [];

    for (const [_key, value] of Object.entries(extPrompts)) {
      const ep = value as any;
      if (!ep?.value) continue;

      const msg = { role: "system" as const, content: ep.value };
      const position = ep.position ?? 0;

      if (position === 0) {
        before.push(msg);
      } else if (position === 1 || (ep.depth != null && ep.depth > 0)) {
        inChat.push({ ...msg, depth: ep.depth ?? 1 });
      } else {
        inPrompt.push(msg);
      }
    }

    return { before_prompt: before, in_chat: inChat, in_prompt: inPrompt };
  } catch (e) {
    console.debug("[ModuleImpl:src_extension_prompts] Error:", e);
  }

  return { before_prompt: [], in_chat: [], in_prompt: [] };
}

/**
 * Get flow execution context — chat_id, message_id, trigger info.
 */
export function collectFlowContext(context: {
  chatId?: string;
  messageId?: number;
  trigger?: string;
  requestId?: string;
}): Record<string, any> {
  return {
    chat_id: context.chatId ?? "",
    message_id: context.messageId ?? 0,
    trigger: context.trigger ?? "manual",
    request_id: context.requestId ?? "",
    timestamp: Date.now(),
  };
}

/**
 * Collect serial (upstream) workflow results.
 * In serial execution mode, previous workflow results are passed forward.
 */
export function collectSerialResults(
  previousResults: any[] | undefined,
): any[] {
  return Array.isArray(previousResults) ? previousResults : [];
}
