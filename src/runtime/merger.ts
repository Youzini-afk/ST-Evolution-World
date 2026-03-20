import { ControllerModel } from "./contracts";
import { checkEjsSyntax } from "./ejs-internal";
import { resolveControllerEntryNameMap } from "./helpers";
import {
  EwSettings,
  MergeInput,
  MergedPlan,
  MergedWorldbookDesiredEntry,
  Prioritized,
} from "./types";

function comparePriority(
  lhs: { priority: number; flow_order: number },
  rhs: { priority: number; flow_order: number },
): number {
  if (lhs.priority !== rhs.priority) {
    return rhs.priority - lhs.priority;
  }
  return lhs.flow_order - rhs.flow_order;
}

function shouldReplace<T>(
  current: Prioritized<T> | undefined,
  next: Prioritized<T>,
): boolean {
  if (!current) {
    return true;
  }
  if (next.priority > current.priority) {
    return true;
  }
  if (next.priority < current.priority) {
    return false;
  }
  return next.flow_order >= current.flow_order;
}

/**
 * Normalize an entry name: bare names get the dynamic entry prefix.
 * Names that already have the prefix, or start with the controller prefix, are untouched.
 */
function normalizeEntryName(
  name: string,
  dynPrefix: string,
  ctrlPrefix: string,
): string {
  if (name.startsWith(dynPrefix)) return name;
  if (name.startsWith(ctrlPrefix)) return name;
  return dynPrefix + name;
}

function normalizeControllerModel(
  model: ControllerModel,
  dynPrefix: string,
  ctrlPrefix: string,
): ControllerModel {
  return {
    ...model,
    fallback_entries: model.fallback_entries.map((name) =>
      normalizeEntryName(name, dynPrefix, ctrlPrefix),
    ),
    activate_entries: (model.activate_entries ?? []).map((entry) => ({
      ...entry,
      entry: normalizeEntryName(entry.entry, dynPrefix, ctrlPrefix),
    })),
    rules: model.rules.map((rule) => ({
      ...rule,
      include_entries: rule.include_entries.map((name) =>
        normalizeEntryName(name, dynPrefix, ctrlPrefix),
      ),
    })),
  };
}

export function mergeFlowResults(
  results: MergeInput,
  settings: EwSettings,
): MergedPlan {
  const sorted = [...results].sort((lhs, rhs) =>
    comparePriority(
      { priority: lhs.flow.priority, flow_order: lhs.flow_order },
      { priority: rhs.flow.priority, flow_order: rhs.flow_order },
    ),
  );

  // Declarative: desired_entries (final state) and remove_entries (deletions).
  const desiredMap = new Map<
    string,
    Prioritized<MergedWorldbookDesiredEntry>
  >();
  const removeMap = new Map<string, Prioritized<null>>();

  // Multi-controller: each flow keeps its own controller_model, keyed by flow.id.
  const controllerModels = new Map<
    string,
    MergedPlan["controller_models"][number]
  >();
  const replyParts: string[] = [];
  const diagnostics: Record<string, any> = {};

  for (const result of sorted) {
    const priority = result.flow.priority;
    const flowOrder = result.flow_order;
    const worldbookOps = result.response.operations.worldbook;
    const normalizedControllerModel = result.response.operations
      .controller_model
      ? normalizeControllerModel(
          result.response.operations.controller_model,
          settings.dynamic_entry_prefix,
          settings.controller_entry_prefix,
        )
      : undefined;
    const referencedEntries = normalizedControllerModel
      ? new Set(
          _.uniq([
            ...normalizedControllerModel.fallback_entries,
            ...(normalizedControllerModel.activate_entries ?? []).map(
              (entry) => entry.entry,
            ),
            ...normalizedControllerModel.rules.flatMap(
              (rule) => rule.include_entries,
            ),
          ]),
        )
      : new Set<string>();

    for (const desired of worldbookOps.desired_entries) {
      const normalizedName = normalizeEntryName(
        desired.name,
        settings.dynamic_entry_prefix,
        settings.controller_entry_prefix,
      );
      const next: Prioritized<MergedWorldbookDesiredEntry> = {
        value: {
          name: normalizedName,
          content: desired.content,
          enabled: desired.enabled,
          source_flow_id: result.flow.id,
          source_flow_name: result.flow.name?.trim() || result.flow.id,
          priority,
          flow_order: flowOrder,
          dyn_write: result.flow.dyn_write,
        },
        priority,
        flow_order: flowOrder,
      };
      const current = desiredMap.get(normalizedName);
      if (shouldReplace(current, next)) {
        desiredMap.set(normalizedName, next);
      }

      if (
        result.flow.dyn_write.activation_mode === "worldbook_direct" &&
        normalizedControllerModel &&
        referencedEntries.has(normalizedName)
      ) {
        console.warn(
          `[EW Merger] potential_double_injection: flow "${result.flow.id}" references direct Dyn entry "${normalizedName}"`,
        );
      }
    }

    for (const removal of worldbookOps.remove_entries) {
      const normalizedName = normalizeEntryName(
        removal.name,
        settings.dynamic_entry_prefix,
        settings.controller_entry_prefix,
      );
      const next: Prioritized<null> = {
        value: null,
        priority,
        flow_order: flowOrder,
      };
      const current = removeMap.get(normalizedName);
      if (shouldReplace(current, next)) {
        removeMap.set(normalizedName, next);
      }
    }

    if (normalizedControllerModel) {
      const flowId = result.flow.id;
      const flowName = result.flow.name?.trim() || result.flow.id;
      controllerModels.set(flowId, {
        flow_id: flowId,
        flow_name: flowName,
        entry_name: "",
        model: normalizedControllerModel,
      });
    }

    if (result.response.reply_instruction.trim()) {
      replyParts.push(
        `[Flow:${result.flow.id}]\n${result.response.reply_instruction.trim()}`,
      );
    }

    diagnostics[result.flow.id] = result.response.diagnostics;
  }

  // Conflict resolution: remove wins over desired when priority is >= .
  for (const [name, removal] of removeMap.entries()) {
    const desired = desiredMap.get(name);
    if (!desired) {
      continue;
    }

    if (removal.priority >= desired.priority) {
      desiredMap.delete(name);
    } else {
      removeMap.delete(name);
    }
  }

  if (controllerModels.size === 0) {
    console.warn(
      "[EW Merger] No flow returned controller_model — all controllers will be empty.",
    );
  }

  const controllerEntryNameMap = resolveControllerEntryNameMap(
    settings.controller_entry_prefix,
    [...controllerModels.values()].map((slot) => ({
      flow_id: slot.flow_id,
      flow_name: slot.flow_name,
    })),
  );

  const desiredEntries = [...desiredMap.values()].map((value) => value.value);

  // EJS syntax validation: warn (but do not block) on malformed EJS in entries.
  for (const entry of desiredEntries) {
    const err = checkEjsSyntax(entry.content);
    if (err) {
      console.warn(
        `[EW Merger] EJS syntax error in entry "${entry.name}":`,
        err,
      );
      try {
        (globalThis as any).toastr?.warning(
          `EJS 语法错误: ${entry.name}`,
          "Evolution World",
        );
      } catch {
        /* noop */
      }
    }
  }

  // Normalize entry names inside each controller_model (add EW/Dyn/ prefix).
  const normalizedControllers = [...controllerModels.values()].map((slot) => ({
    ...slot,
    entry_name: controllerEntryNameMap.get(slot.flow_id) ?? slot.entry_name,
  }));

  return {
    worldbook: {
      desired_entries: desiredEntries,
      remove_entries: [...removeMap.keys()].map((name) => ({ name })),
    },
    controller_models: normalizedControllers,
    reply_instruction: replyParts.join("\n\n"),
    diagnostics,
  };
}
