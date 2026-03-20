import {
  getChatId,
  getChatMessages,
  getLastMessageId,
} from "./compat/character";
import { getWorldbook, replaceWorldbook } from "./compat/worldbook";
import { validateEjsTemplate } from "./controller-renderer";
import { rerollCurrentAfterReplyWorkflow } from "./events";
import { localizeSnapshotsForCurrentChat } from "./floor-binding";
import {
  getMessageVersionInfo,
  resolveControllerSnapshotEntryName,
} from "./helpers";
import { runWorkflow } from "./pipeline";
import {
  getLastIo,
  getLastRun,
  getSettings,
  patchSettings,
  readControllerBackup,
} from "./settings";
import { ContextCursor, EwSettingsSchema } from "./types";
import { resolveTargetWorldbook } from "./worldbook-runtime";

declare global {
  interface Window {
    EvolutionWorldAPI?: {
      getConfig: () => ReturnType<typeof getSettings>;
      setConfig: (
        partial: Partial<ReturnType<typeof getSettings>>,
      ) => Promise<void>;
      validateConfig: () => { ok: boolean; errors: string[] };
      runNow: (message?: string) => Promise<{ ok: boolean; reason?: string }>;
      getLastRun: () => ReturnType<typeof getLastRun>;
      getLastIo: () => ReturnType<typeof getLastIo>;
      validateControllerSyntax: () => Promise<{ ok: boolean; reason?: string }>;
      rollbackController: () => Promise<{ ok: boolean; reason?: string }>;
      rerollCurrentAfterReply: () => Promise<{ ok: boolean; reason?: string }>;
      rederiveWorkflowAtFloor: (input: {
        message_id: number;
        timing: "before_reply" | "after_reply" | "manual";
        target_version_key?: string;
        confirm_legacy?: boolean;
        capsule_mode?: "full" | "light";
      }) => Promise<{
        ok: boolean;
        reason?: string;
        result?: {
          message_id: number;
          anchor_message_id: number;
          legacy_approx: boolean;
          writeback_applied: number;
          writeback_conflicts: number;
          writeback_conflict_names: string[];
        };
      }>;
      localizeSnapshots: () => Promise<{
        ok: boolean;
        reason?: string;
        result?: {
          localized: number;
          uplifted: number;
          unresolved: number;
          skipped: number;
          mutated_messages: number;
          warnings: string[];
        };
      }>;
    };
  }
}

async function validateControllerSyntax(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  try {
    const settings = getSettings();
    const target = await resolveTargetWorldbook(settings);
    if (!target) {
      return { ok: false, reason: "no worldbook found for current character" };
    }
    const controllerEntries = target.entries.filter((entry) =>
      entry.name.startsWith(settings.controller_entry_prefix),
    );
    if (controllerEntries.length === 0) {
      return {
        ok: false,
        reason: `no controller entries found with prefix: ${settings.controller_entry_prefix}`,
      };
    }

    const errors: string[] = [];
    for (const entry of controllerEntries) {
      try {
        await validateEjsTemplate(entry.content);
      } catch (error) {
        errors.push(
          `${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (errors.length > 0) {
      return { ok: false, reason: errors.join("\n") };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function rollbackController(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const settings = getSettings();
    const chatId = getChatId();
    const backup = readControllerBackup(chatId);
    if (!backup) {
      return { ok: false, reason: "no backup found for current chat" };
    }

    const entries = klona(await getWorldbook(backup.worldbook_name));

    const backupByEntryName = new Map(
      backup.controller_content.map((snapshot) => [
        resolveControllerSnapshotEntryName(
          settings.controller_entry_prefix,
          snapshot,
        ),
        snapshot,
      ]),
    );

    for (const entry of entries) {
      if (!entry.name.startsWith(settings.controller_entry_prefix)) {
        continue;
      }
      const restored = backupByEntryName.get(entry.name);
      if (restored) {
        entry.content = restored.content;
        entry.enabled = true;
      } else {
        entry.content = "";
        entry.enabled = false;
      }
    }

    for (const snapshot of backup.controller_content) {
      const entryName = resolveControllerSnapshotEntryName(
        settings.controller_entry_prefix,
        snapshot,
      );
      const controller = entries.find((entry) => entry.name === entryName);
      if (controller) {
        continue;
      } else {
        const uid = (_.max(entries.map((entry) => entry.uid)) ?? 0) + 1;
        entries.push({
          uid,
          name: entryName,
          enabled: true,
          strategy: {
            type: "constant",
            keys: [],
            keys_secondary: { logic: "and_any", keys: [] },
            scan_depth: "same_as_global",
          },
          position: {
            type: "at_depth",
            role: "system",
            depth: 0,
            order: 14720,
          },
          content: snapshot.content,
          probability: 100,
          recursion: {
            prevent_incoming: true,
            prevent_outgoing: true,
            delay_until: null,
          },
          effect: { sticky: null, cooldown: null, delay: null },
          extra: {},
        });
      }
    }

    await replaceWorldbook(backup.worldbook_name, entries, {
      render: "debounced",
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function rederiveWorkflowAtFloor(input: {
  message_id: number;
  timing: "before_reply" | "after_reply" | "manual";
  target_version_key?: string;
  confirm_legacy?: boolean;
  capsule_mode?: "full" | "light";
}): Promise<{
  ok: boolean;
  reason?: string;
  result?: {
    message_id: number;
    anchor_message_id: number;
    legacy_approx: boolean;
    writeback_applied: number;
    writeback_conflicts: number;
    writeback_conflict_names: string[];
  };
}> {
  try {
    const messageId = Math.max(0, Math.trunc(Number(input.message_id) || 0));
    const message = getChatMessages(messageId)[0];
    if (!message) {
      return { ok: false, reason: `message #${messageId} not found` };
    }

    const role =
      message?.role === "assistant"
        ? "assistant"
        : message?.role === "user"
          ? "user"
          : "other";
    const versionInfo = getMessageVersionInfo(message);
    const targetVersionKey =
      String(input.target_version_key ?? versionInfo.version_key).trim() ||
      versionInfo.version_key;
    const contextCursor: ContextCursor = {
      chat_id: String(getChatId() ?? "").trim(),
      target_message_id: messageId,
      target_role: role,
      target_version_key: targetVersionKey,
      timing: input.timing,
      capsule_mode: input.capsule_mode ?? "full",
      source_user_message_id:
        input.timing === "before_reply" && role === "user"
          ? messageId
          : undefined,
      assistant_message_id:
        input.timing === "after_reply" && role === "assistant"
          ? messageId
          : undefined,
    };

    const result = await runWorkflow({
      message_id: messageId,
      user_input: String(message?.message ?? ""),
      trigger: {
        timing: input.timing,
        source: "api_rederive",
        generation_type: "rederive",
        user_message_id:
          input.timing === "before_reply" && role === "user"
            ? messageId
            : undefined,
        assistant_message_id:
          input.timing === "after_reply" && role === "assistant"
            ? messageId
            : undefined,
      },
      mode: "manual",
      inject_reply: false,
      timing_filter: input.timing === "manual" ? undefined : input.timing,
      job_type: "historical_rederive",
      context_cursor: contextCursor,
      writeback_policy: "dual_diff_merge",
      rederive_options: {
        legacy_approx: Boolean(input.confirm_legacy),
        capsule_mode: input.capsule_mode ?? "full",
      },
    });

    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason ?? "historical rederive failed",
      };
    }

    const writebackApplied = Math.max(
      0,
      Math.trunc(
        Number(
          (result.diagnostics as Record<string, unknown> | undefined)
            ?.writeback_applied ?? 0,
        ) || 0,
      ),
    );
    const writebackConflicts = Math.max(
      0,
      Math.trunc(
        Number(
          (result.diagnostics as Record<string, unknown> | undefined)
            ?.writeback_conflicts ?? 0,
        ) || 0,
      ),
    );
    const writebackConflictNames = Array.isArray(
      (result.diagnostics as Record<string, unknown> | undefined)
        ?.writeback_conflict_names,
    )
      ? (
          (result.diagnostics as Record<string, unknown>)
            .writeback_conflict_names as unknown[]
        )
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      : [];

    return {
      ok: true,
      result: {
        message_id: messageId,
        anchor_message_id: messageId,
        legacy_approx: Boolean(input.confirm_legacy),
        writeback_applied: writebackApplied,
        writeback_conflicts: writebackConflicts,
        writeback_conflict_names: writebackConflictNames,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function initGlobalApi() {
  window.EvolutionWorldAPI = {
    getConfig: () => getSettings(),
    setConfig: async (partial) => {
      patchSettings(partial);
    },
    validateConfig: () => {
      const result = EwSettingsSchema.safeParse(getSettings());
      if (result.success) {
        return { ok: true, errors: [] };
      }

      return {
        ok: false,
        errors: result.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      };
    },
    runNow: async (message) => {
      const text = message ?? "";
      const input = text.trim() || (getChatMessages(-1)[0]?.message ?? "");
      const result = await runWorkflow({
        message_id: getLastMessageId(),
        user_input: input,
        mode: "manual",
        inject_reply: false,
      });
      return { ok: result.ok, reason: result.reason };
    },
    getLastRun: () => getLastRun(),
    getLastIo: () => getLastIo(),
    validateControllerSyntax,
    rollbackController,
    rerollCurrentAfterReply: () => rerollCurrentAfterReplyWorkflow(),
    rederiveWorkflowAtFloor,
    localizeSnapshots: async () => {
      try {
        const result = await localizeSnapshotsForCurrentChat(getSettings());
        return { ok: true, result };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function disposeGlobalApi() {
  delete window.EvolutionWorldAPI;
}
