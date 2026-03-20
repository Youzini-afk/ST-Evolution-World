import { getChatId } from "./compat/character";
import { FlowRequestSchema } from "./contracts";
import { uuidv4 } from "./helpers";
import { buildDynSnapshotFromEntry, resolveTargetWorldbook, } from "./worldbook-runtime";
function normalizeEntryNames(names) {
    return _.uniq((names ?? []).map((name) => String(name ?? "").trim()).filter(Boolean));
}
async function collectDynEntryContext(settings, activeNamesInput) {
    const activeNames = normalizeEntryNames(activeNamesInput);
    try {
        const target = await resolveTargetWorldbook(settings);
        const managedEntries = (target?.entries ?? []).filter((entry) => typeof entry.name === "string" &&
            entry.name.startsWith(settings.dynamic_entry_prefix));
        const allManagedNames = _.uniq(managedEntries.map((entry) => entry.name));
        const activeSet = new Set(activeNames);
        return {
            active_names: activeNames.filter((name) => allManagedNames.includes(name)),
            inactive_names: allManagedNames.filter((name) => !activeSet.has(name)),
            entries: managedEntries.map((entry) => buildDynSnapshotFromEntry(entry)),
            write_hint: {
                mode: "overwrite",
                item_format: "markdown_list",
                activation_mode: "controller_only",
            },
        };
    }
    catch (error) {
        console.debug("[Evolution World] collectDynEntryContext failed:", error);
        return {
            active_names: activeNames,
            inactive_names: [],
            entries: [],
            write_hint: {
                mode: "overwrite",
                item_format: "markdown_list",
                activation_mode: "controller_only",
            },
        };
    }
}
export async function buildFlowRequest(input) {
    const chatId = String(getChatId() ?? "unknown");
    const requestId = input.request_id ?? uuidv4();
    const ewDynEntries = await collectDynEntryContext(input.settings, input.active_dyn_entry_names);
    ewDynEntries.write_hint = {
        mode: input.flow.dyn_write.mode,
        item_format: input.flow.dyn_write.item_format,
        activation_mode: input.flow.dyn_write.activation_mode,
    };
    const payload = FlowRequestSchema.parse({
        version: "ew-flow/v1",
        request_id: requestId,
        chat_id: chatId,
        message_id: input.message_id,
        ...(input.user_input ? { user_input: input.user_input } : {}),
        ...(input.trigger ? { trigger: input.trigger } : {}),
        flow: {
            id: input.flow.id,
            name: input.flow.name,
            priority: input.flow.priority,
            timeout_ms: input.flow.timeout_ms,
            generation_options: input.flow.generation_options,
            behavior_options: input.flow.behavior_options,
        },
        context: {
            turns: input.flow.context_turns,
            extract_rules: input.flow.extract_rules,
            exclude_rules: input.flow.exclude_rules,
            ew_dyn_entries: ewDynEntries,
        },
        ...(input.context_cursor
            ? {
                rederive_context: {
                    job_type: input.job_type ?? "live_auto",
                    writeback_policy: input.writeback_policy ?? "dual_diff_merge",
                    target_message_id: input.context_cursor.target_message_id,
                    target_version_key: input.context_cursor.target_version_key,
                    target_role: input.context_cursor.target_role,
                    legacy_approx: Boolean(input.legacy_approx),
                    capsule_mode: input.context_cursor.capsule_mode ?? "full",
                },
            }
            : {}),
        serial_results: input.serial_results ?? [],
    });
    return payload;
}
//# sourceMappingURL=context-builder.js.map