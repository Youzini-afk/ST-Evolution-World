import { validateEjsTemplate } from './controller-renderer';
import { rerollCurrentAfterReplyWorkflow } from './events';
import { resolveControllerSnapshotEntryName } from './helpers';
import { runWorkflow } from './pipeline';
import { getLastIo, getLastRun, getSettings, patchSettings, readControllerBackup } from './settings';
import { EwSettingsSchema } from './types';
import { resolveTargetWorldbook } from './worldbook-runtime';

declare global {
  interface Window {
    EvolutionWorldAPI?: {
      getConfig: () => ReturnType<typeof getSettings>;
      setConfig: (partial: Partial<ReturnType<typeof getSettings>>) => Promise<void>;
      validateConfig: () => { ok: boolean; errors: string[] };
      runNow: (message?: string) => Promise<{ ok: boolean; reason?: string }>;
      getLastRun: () => ReturnType<typeof getLastRun>;
      getLastIo: () => ReturnType<typeof getLastIo>;
      validateControllerSyntax: () => Promise<{ ok: boolean; reason?: string }>;
      rollbackController: () => Promise<{ ok: boolean; reason?: string }>;
      rerollCurrentAfterReply: () => Promise<{ ok: boolean; reason?: string }>;
    };
  }
}

async function validateControllerSyntax(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const settings = getSettings();
    const target = await resolveTargetWorldbook(settings);
    const controllerEntries = target.entries.filter(entry => entry.name.startsWith(settings.controller_entry_prefix));
    if (controllerEntries.length === 0) {
      return { ok: false, reason: `no controller entries found with prefix: ${settings.controller_entry_prefix}` };
    }

    const errors: string[] = [];
    for (const entry of controllerEntries) {
      try {
        await validateEjsTemplate(entry.content);
      } catch (error) {
        errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0) {
      return { ok: false, reason: errors.join('\n') };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function rollbackController(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const settings = getSettings();
    const chatId = String(SillyTavern.getCurrentChatId?.() ?? SillyTavern.chatId ?? 'unknown');
    const backup = readControllerBackup(chatId);
    if (!backup) {
      return { ok: false, reason: 'no backup found for current chat' };
    }

    const entries = klona(await getWorldbook(backup.worldbook_name));

    const backupByEntryName = new Map(
      backup.controller_content.map(snapshot => [
        resolveControllerSnapshotEntryName(settings.controller_entry_prefix, snapshot),
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
        entry.content = '';
        entry.enabled = false;
      }
    }

    for (const snapshot of backup.controller_content) {
      const entryName = resolveControllerSnapshotEntryName(settings.controller_entry_prefix, snapshot);
      const controller = entries.find(entry => entry.name === entryName);
      if (controller) {
        continue;
      } else {
        const uid = (_.max(entries.map(entry => entry.uid)) ?? 0) + 1;
        entries.push({
          uid,
          name: entryName,
          enabled: true,
          strategy: {
            type: 'constant',
            keys: [],
            keys_secondary: { logic: 'and_any', keys: [] },
            scan_depth: 'same_as_global',
          },
          position: {
            type: 'at_depth',
            role: 'system',
            depth: 0,
            order: 14720,
          },
          content: snapshot.content,
          probability: 100,
          recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
          effect: { sticky: null, cooldown: null, delay: null },
          extra: {},
        });
      }
    }

    await replaceWorldbook(backup.worldbook_name, entries, { render: 'debounced' });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function initGlobalApi() {
  window.EvolutionWorldAPI = {
    getConfig: () => getSettings(),
    setConfig: async partial => {
      patchSettings(partial);
    },
    validateConfig: () => {
      const result = EwSettingsSchema.safeParse(getSettings());
      if (result.success) {
        return { ok: true, errors: [] };
      }

      return {
        ok: false,
        errors: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      };
    },
    runNow: async message => {
      const text = message ?? '';
      const input = text.trim() || (getChatMessages(-1)[0]?.message ?? '');
      const result = await runWorkflow({
        message_id: getLastMessageId(),
        user_input: input,
        mode: 'manual',
        inject_reply: false,
      });
      return { ok: result.ok, reason: result.reason };
    },
    getLastRun: () => getLastRun(),
    getLastIo: () => getLastIo(),
    validateControllerSyntax,
    rollbackController,
    rerollCurrentAfterReply: () => rerollCurrentAfterReplyWorkflow(),
  };
}

export function disposeGlobalApi() {
  delete window.EvolutionWorldAPI;
}
