/* ═══ Module Implementations — Transform Modules ═══ */
/*
 * Runtime implementations for Transform-category modules.
 * These render, convert, and restructure data.
 */

import type { ModuleOutput } from '../../ui/components/graph/module-types';
import type { WiEntry, ChatMessage } from './filter-impls';

// ── EJS Template Render ──

/**
 * Render an EJS template string with the given context.
 * Lazy-imports renderEjsContent from ejs-internal.
 */
export async function transformEjsRender(
  template: string,
  context: Record<string, any>,
): Promise<string> {
  if (!template) return '';

  try {
    const { renderEjsContent } = await import('../ejs-internal');
    return await renderEjsContent(template, context);
  } catch (e) {
    console.debug('[TransformImpl:ejs_render] EJS render error:', e);
    // Fallback: return template unmodified
    return template;
  }
}

// ── Macro Replace ──

/**
 * Replace {{user}}, {{char}}, {{persona}}, etc. macro variables in text.
 * Uses ST's global runtime variables.
 */
export function transformMacroReplace(text: string): string {
  if (!text) return '';

  try {
    const stContext = (globalThis as any).SillyTavern?.getContext?.();
    const charName = stContext?.name2 ?? (globalThis as any).name2 ?? '{{char}}';
    const userName = stContext?.name1 ?? (globalThis as any).name1 ?? '{{user}}';
    const personaDesc = stContext?.persona ?? '';

    let result = text;
    result = result.replace(/\{\{char\}\}/gi, charName);
    result = result.replace(/\{\{user\}\}/gi, userName);
    result = result.replace(/\{\{persona\}\}/gi, personaDesc);

    // Date/time macros
    const now = new Date();
    result = result.replace(/\{\{date\}\}/gi, now.toLocaleDateString());
    result = result.replace(/\{\{time\}\}/gi, now.toLocaleTimeString());
    result = result.replace(/\{\{datetime\}\}/gi, now.toLocaleString());
    result = result.replace(/\{\{weekday\}\}/gi, now.toLocaleDateString(undefined, { weekday: 'long' }));

    return result;
  } catch {
    return text;
  }
}

// ── Controller Expand ──

/**
 * Expand EW/Controller entries: entries containing getwi/dynamic references
 * are split into individual sub-entries.
 */
export async function transformControllerExpand(
  entries: WiEntry[],
): Promise<WiEntry[]> {
  if (!entries || entries.length === 0) return [];

  try {
    const { renderControllerTemplate } = await import('../controller-renderer');

    const expanded: WiEntry[] = [];
    for (const entry of entries) {
      // Check if it's a controller entry (contains EW/Controller pattern)
      const isController = entry.comment?.includes('EW/Controller') ||
        entry.content?.includes('<%') ||
        entry.key?.some(k => k.startsWith('EW/'));

      if (isController && entry.content) {
        try {
          const rendered = await renderControllerTemplate(
            { content: entry.content, uid: entry.uid ?? 0, key: entry.key ?? [] },
            'EW/Dyn/',
          );

          // If rendered content differs, it was a controller
          if (rendered !== entry.content) {
            // Split by EW/Dyn/ separator pattern
            const dynPattern = /\[EW\/Dyn\/([^\]]+)\]/g;
            let match;
            let lastIdx = 0;
            const parts: { name: string; content: string }[] = [];

            while ((match = dynPattern.exec(rendered)) !== null) {
              if (lastIdx > 0) {
                const prevContent = rendered.slice(lastIdx, match.index).trim();
                if (prevContent) {
                  parts[parts.length - 1].content = prevContent;
                }
              }
              parts.push({ name: match[1], content: '' });
              lastIdx = match.index + match[0].length;
            }

            if (parts.length > 0 && lastIdx < rendered.length) {
              parts[parts.length - 1].content = rendered.slice(lastIdx).trim();
            }

            if (parts.length > 0) {
              for (const part of parts) {
                if (part.content) {
                  expanded.push({
                    ...entry,
                    key: [part.name],
                    content: part.content,
                    comment: `${entry.comment ?? ''} [展开自 Controller]`,
                  });
                }
              }
              continue;
            }
          }
        } catch (e) {
          console.debug('[TransformImpl:controller_expand] Error:', e);
        }
      }

      // Not a controller or expansion failed: pass through
      expanded.push(entry);
    }
    return expanded;
  } catch {
    return entries;
  }
}

// ── WI Bucket ──

/**
 * Sort WI entries into position buckets: before, after, atDepth.
 *
 * Position values (from ST WI spec):
 *   0 = before main prompt (before_char)
 *   1 = after main prompt (after_char)
 *   2 = before example messages
 *   3 = after example messages
 *   4 = at depth (requires depth value)
 *   5 = before system prompt
 *   6 = after system prompt
 *   7-9 = various depths
 */
export function transformWiBucket(entries: WiEntry[]): {
  before: WiEntry[];
  after: WiEntry[];
  atDepth: WiEntry[];
} {
  const before: WiEntry[] = [];
  const after: WiEntry[] = [];
  const atDepth: WiEntry[] = [];

  for (const entry of entries) {
    const pos = entry.position ?? 1;

    if (pos === 4 || pos === 7 || pos === 8 || pos === 9) {
      atDepth.push(entry);
    } else if (pos === 0 || pos === 2 || pos === 5) {
      before.push(entry);
    } else {
      after.push(entry);
    }
  }

  // Sort each bucket by order
  const byOrder = (a: WiEntry, b: WiEntry) => (a.order ?? 100) - (b.order ?? 100);
  before.sort(byOrder);
  after.sort(byOrder);
  atDepth.sort(byOrder);

  return { before, after, atDepth };
}

// ── Entry Name Inject ──

/**
 * Prepend [entry name] label before each WI entry's content
 * when injected as messages.
 */
export function transformEntryNameInject(
  messages: ChatMessage[],
  _snapshots?: any,
): ChatMessage[] {
  // This is a pass-through for now —
  // The actual entry name injection is done during prompt assembly
  // where entries have metadata available.
  return messages;
}
