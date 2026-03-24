/* ═══ Runtime Node Registry — Plugin Contract v1 ═══ */
/*
 * Owns the mapping from moduleId → executable node handler.
 *
 * Design goals (P2.1 first closed loop):
 *   - Define the minimal runtime plugin contract v1 (NodeHandlerDescriptor)
 *   - Own the "moduleId → handler" registry that was previously inlined
 *     inside graph-executor.ts (createNodeHandlerMap)
 *   - Provide an explicit fallback strategy at the registry layer
 *   - Keep all existing handler logic intact — bridge, not rewrite
 *   - Do NOT open external plugin loading (internal-only for now)
 */

import {
  getModuleBlueprint,
  getModuleExplainContract,
  getModuleMetadataSummary,
} from "../ui/components/graph/module-registry";
import type {
  ExecutionContext,
  GraphCompilePlanNode,
  GraphNodeInputSource,
  HostCommitContract,
  HostWriteDescriptor,
  ModuleMetadataSemanticSummary,
  ModuleOutput,
  WorkbenchCapability,
  WorkbenchGraph,
  WorkbenchNode,
  WorkbenchSideEffectLevel,
} from "../ui/components/graph/module-types";

// ── Plugin Contract v1 ──────────────────────────────────────────────

/**
 * Lazy-loadable runtime implementation module set.
 * Mirrors the previous `RuntimeImplModules` from graph-executor.
 */
export type SourceImpls = typeof import("./module-impls/source-impls");
export type FilterImpls = typeof import("./module-impls/filter-impls");
export type TransformImpls = typeof import("./module-impls/transform-impls");
export type ComposeImpls = typeof import("./module-impls/compose-impls");
export type ExecuteImpls = typeof import("./module-impls/execute-impls");
export type OutputImpls = typeof import("./module-impls/output-impls");

export interface RuntimeImplModules {
  sourceImpls: SourceImpls;
  filterImpls: FilterImpls;
  transformImpls: TransformImpls;
  composeImpls: ComposeImpls;
  executeImpls: ExecuteImpls;
  outputImpls: OutputImpls;
}

/**
 * The request shape passed to every node handler at execution time.
 * Unchanged from the previous inline definition in graph-executor.
 */
export interface NodeHandlerRequest {
  graph: WorkbenchGraph;
  planNode: GraphCompilePlanNode;
  node: WorkbenchNode;
  inputs: Record<string, any>;
  inputSources: GraphNodeInputSource[];
  configuredInputEdgeCounts: Record<string, number>;
  context: ExecutionContext;
  modules: RuntimeImplModules;
}

export interface HostWriteDescriptorRequest {
  planNode: GraphCompilePlanNode;
  node: WorkbenchNode;
  inputs: Record<string, any>;
}

/**
 * The result shape returned by a node handler.
 */
export interface NodeHandlerResult {
  outputs: ModuleOutput;
  handlerId: string;
  capability?: WorkbenchCapability;
  isFallback?: boolean;
  hostWrites?: HostWriteDescriptor[];
  hostCommitContracts?: HostCommitContract[];
}

/**
 * A single node execution handler function.
 */
export type NodeExecutionHandler = (
  request: NodeHandlerRequest,
) => Promise<NodeHandlerResult>;

export type HostWriteDescriptorProducer = (
  request: HostWriteDescriptorRequest,
) => HostWriteDescriptor[];

export type HostCommitContractProducer = (
  hostWrites: HostWriteDescriptor[],
) => HostCommitContract[];

/**
 * **Plugin Contract v1 — NodeHandlerDescriptor**
 *
 * The minimal runtime execution contract for a registered node type.
 * Currently internal-only; not exposed to third-party plugins.
 *
 * Fields:
 *   - `moduleId`  — unique node type identifier (matches ModuleBlueprint.moduleId)
 *   - `handlerId` — stable handler identifier used in traces
 *   - `execute`   — the async execution entry point
 *   - `capability` — explicit runtime capability marker
 *   - `sideEffect` — compatibility alias for legacy side-effect consumers
 *   - `kind`      — 'builtin' for now (reserved for future 'external' plugins)
 */
export interface NodeHandlerDescriptor {
  moduleId: string;
  handlerId: string;
  execute: NodeExecutionHandler;
  capability?: WorkbenchCapability;
  sideEffect?: WorkbenchSideEffectLevel;
  metadataSummary?: {
    semantic: ModuleMetadataSemanticSummary;
    configFields?: readonly {
      key: string;
      label: string;
      required?: boolean;
      defaultValueHint?: string;
      description?: string;
    }[];
    inputConstraintSummary?: readonly string[];
    outputConstraintSummary?: readonly string[];
    helpSummary?: string;
    runtimeUsage?: string;
    diagnosticsLabel?: string;
    explainContract?: ReturnType<typeof getModuleExplainContract>;
  } | null;
  kind: "builtin" | "fallback";
  produceHostWriteDescriptors?: HostWriteDescriptorProducer;
  produceHostCommitContracts?: HostCommitContractProducer;
}

/**
 * Resolution result from the registry.
 * Makes fallback semantics explicit in the resolve path.
 */
export interface RegistryResolveResult {
  descriptor: NodeHandlerDescriptor;
  resolvedVia: "registered" | "fallback";
}

// ── Registry Implementation ─────────────────────────────────────────

const _descriptors = new Map<string, NodeHandlerDescriptor>();
let _initialized = false;

function normalizeCapability(
  capability?: WorkbenchCapability,
  sideEffect?: WorkbenchSideEffectLevel,
  kind?: NodeHandlerDescriptor["kind"],
  moduleId?: string,
  metadataCapability?: ModuleMetadataSemanticSummary["capability"],
): WorkbenchCapability {
  if (capability) return capability;
  if (metadataCapability) return metadataCapability;
  if (kind === "fallback") return "fallback";
  if (moduleId?.startsWith("src_")) return "source";
  if (sideEffect) return sideEffect;
  return "unknown";
}

function getStableMetadataSummary(
  moduleId: string,
): NodeHandlerDescriptor["metadataSummary"] {
  const summary = getModuleMetadataSummary(moduleId);
  if (!summary) {
    return null;
  }
  return {
    ...summary,
    explainContract: getModuleExplainContract(moduleId),
  };
}

function normalizeLegacySideEffect(
  sideEffect?: WorkbenchSideEffectLevel,
  capability?: WorkbenchCapability,
): WorkbenchSideEffectLevel {
  const legacySemantic = sideEffect ?? capability ?? "unknown";
  switch (legacySemantic) {
    case "pure":
    case "reads_host":
    case "writes_host":
    case "unknown":
      return legacySemantic;
    case "source":
      return "reads_host";
    case "network":
    case "fallback":
    default:
      return "unknown";
  }
}

function normalizeDescriptor(
  descriptor: NodeHandlerDescriptor,
): NodeHandlerDescriptor {
  const metadataSummary =
    descriptor.kind === "fallback"
      ? null
      : (descriptor.metadataSummary ??
        getStableMetadataSummary(descriptor.moduleId));
  const capability = normalizeCapability(
    descriptor.capability,
    descriptor.sideEffect,
    descriptor.kind,
    descriptor.moduleId,
    metadataSummary?.semantic.capability,
  );
  const normalizedSideEffect = normalizeLegacySideEffect(
    descriptor.sideEffect,
    capability,
  );
  return {
    ...descriptor,
    capability,
    sideEffect: normalizedSideEffect,
    metadataSummary,
    produceHostWriteDescriptors:
      capability === "writes_host" && descriptor.kind !== "fallback"
        ? descriptor.produceHostWriteDescriptors
        : undefined,
    produceHostCommitContracts:
      capability === "writes_host" && descriptor.kind !== "fallback"
        ? descriptor.produceHostCommitContracts
        : undefined,
  };
}

function createHostCommitContractFromDescriptor(
  descriptor: HostWriteDescriptor,
): HostCommitContract {
  return {
    kind: descriptor.kind,
    mode: "immediate",
    targetType: descriptor.targetType,
    targetId: descriptor.targetId,
    operation: descriptor.operation,
    path: descriptor.path,
    supportsRetry: descriptor.retryable,
  };
}

/**
 * Register a node handler descriptor.
 * Overwrites if moduleId is already registered.
 */
export function registerNodeHandler(descriptor: NodeHandlerDescriptor): void {
  const normalized = normalizeDescriptor(descriptor);
  _descriptors.set(normalized.moduleId, normalized);
}

/**
 * Check whether a moduleId has an explicitly registered handler.
 */
export function hasRegisteredHandler(moduleId: string): boolean {
  return _descriptors.has(moduleId);
}

/**
 * Get descriptor by moduleId without fallback.
 * Returns `undefined` if not registered.
 */
export function getRegisteredHandler(
  moduleId: string,
): NodeHandlerDescriptor | undefined {
  const descriptor = _descriptors.get(moduleId);
  return descriptor ? normalizeDescriptor(descriptor) : undefined;
}

/**
 * Resolve a node handler for the given moduleId.
 *
 * Resolution strategy (explicit at registry layer):
 *   1. If a registered handler exists → return it with `resolvedVia: 'registered'`
 *   2. Otherwise → return the explicit fallback handler with `resolvedVia: 'fallback'`
 *
 * This replaces the implicit fallback that was previously baked into
 * `dispatchNodeExecution()` inside graph-executor.ts.
 */
export function resolveNodeHandler(moduleId: string): RegistryResolveResult {
  const registered = _descriptors.get(moduleId);
  if (registered) {
    return {
      descriptor: normalizeDescriptor(registered),
      resolvedVia: "registered",
    };
  }
  return {
    descriptor: createFallbackDescriptor(moduleId),
    resolvedVia: "fallback",
  };
}

/**
 * Returns all registered moduleIds. Useful for diagnostics.
 */
export function getRegisteredModuleIds(): string[] {
  return Array.from(_descriptors.keys());
}

// ── Fallback Descriptor (Explicit Strategy) ─────────────────────────

/**
 * Creates a fallback descriptor for an unregistered moduleId.
 *
 * Behavior is identical to the previous `createFallbackNodeHandler()`:
 *   - If the blueprint has no output ports → empty outputs
 *   - Otherwise → pass through the first input value to all output ports
 *   - handlerId is always `__fallback__`, isFallback is always `true`
 *
 * This is now an explicit registry-layer strategy, not an implicit
 * executor-level catch-all.
 */
function createFallbackDescriptor(moduleId: string): NodeHandlerDescriptor {
  return {
    moduleId,
    handlerId: "__fallback__",
    capability: "fallback",
    sideEffect: "unknown",
    metadataSummary: null,
    kind: "fallback",
    execute: async ({ node, inputs }) => {
      const blueprint = getModuleBlueprint(node.moduleId);
      const outPorts = blueprint.ports.filter((p) => p.direction === "out");
      if (outPorts.length === 0) {
        return {
          outputs: {},
          handlerId: "__fallback__",
          capability: "fallback",
          isFallback: true,
        };
      }

      const firstInValue = Object.values(inputs)[0];
      const outputs: ModuleOutput = {};
      for (const port of outPorts) {
        outputs[port.id] = firstInValue ?? null;
      }

      return {
        outputs,
        handlerId: "__fallback__",
        capability: "fallback",
        isFallback: true,
      };
    },
  };
}

// ── Built-in Node Registration ──────────────────────────────────────

/**
 * Register all built-in node handlers.
 * This is called lazily on first resolve if not already initialized,
 * or can be called explicitly.
 *
 * The handler implementations bridge to the existing module-impls/* modules,
 * preserving all current behavior exactly.
 */
export function registerBuiltinHandlers(modules: RuntimeImplModules): void {
  const {
    sourceImpls,
    filterImpls,
    transformImpls,
    composeImpls,
    executeImpls,
    outputImpls,
  } = modules;

  // ── Source handlers ──
  registerNodeHandler({
    moduleId: "src_char_fields",
    handlerId: "src_char_fields",
    kind: "builtin",
    sideEffect: "reads_host",
    execute: async () => ({
      outputs: sourceImpls.collectCharFields(),
      handlerId: "src_char_fields",
    }),
  });

  registerNodeHandler({
    moduleId: "src_chat_history",
    handlerId: "src_chat_history",
    kind: "builtin",
    sideEffect: "reads_host",
    execute: async ({ node }) => ({
      outputs: {
        messages: sourceImpls.collectChatHistory(
          node.config.context_turns ?? 8,
        ),
      },
      handlerId: "src_chat_history",
    }),
  });

  registerNodeHandler({
    moduleId: "src_worldbook_raw",
    handlerId: "src_worldbook_raw",
    kind: "builtin",
    sideEffect: "reads_host",
    execute: async ({ node }) => ({
      outputs: { entries: sourceImpls.collectWorldbookRaw(node.config) },
      handlerId: "src_worldbook_raw",
    }),
  });

  registerNodeHandler({
    moduleId: "src_extension_prompts",
    handlerId: "src_extension_prompts",
    kind: "builtin",
    sideEffect: "reads_host",
    execute: async () => ({
      outputs: sourceImpls.collectExtensionPrompts(),
      handlerId: "src_extension_prompts",
    }),
  });

  registerNodeHandler({
    moduleId: "src_user_input",
    handlerId: "src_user_input",
    kind: "builtin",
    sideEffect: "reads_host",
    execute: async ({ context }) => ({
      outputs: { text: context.userInput ?? "" },
      handlerId: "src_user_input",
    }),
  });

  registerNodeHandler({
    moduleId: "src_flow_context",
    handlerId: "src_flow_context",
    kind: "builtin",
    sideEffect: "reads_host",
    execute: async ({ context }) => ({
      outputs: { context: sourceImpls.collectFlowContext(context) },
      handlerId: "src_flow_context",
    }),
  });

  registerNodeHandler({
    moduleId: "src_serial_results",
    handlerId: "src_serial_results",
    kind: "builtin",
    sideEffect: "reads_host",
    execute: async ({ context }) => ({
      outputs: {
        results: sourceImpls.collectSerialResults(
          (context as any).previousResults,
        ),
      },
      handlerId: "src_serial_results",
    }),
  });

  // ── Filter handlers ──
  registerNodeHandler({
    moduleId: "flt_wi_keyword_match",
    handlerId: "flt_wi_keyword_match",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const entries = Array.isArray(inputs.entries) ? inputs.entries : [];
      const chatTexts =
        typeof inputs.chat_texts === "string"
          ? inputs.chat_texts
          : Array.isArray(inputs.chat_texts)
            ? inputs.chat_texts.map((m: any) => m.content ?? "").join("\n")
            : "";
      return {
        outputs: {
          activated: filterImpls.filterWiKeywordMatch(entries, chatTexts),
        },
        handlerId: "flt_wi_keyword_match",
      };
    },
  });

  registerNodeHandler({
    moduleId: "flt_wi_probability",
    handlerId: "flt_wi_probability",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => ({
      outputs: {
        entries_out: filterImpls.filterWiProbability(
          Array.isArray(inputs.entries_in) ? inputs.entries_in : [],
        ),
      },
      handlerId: "flt_wi_probability",
    }),
  });

  registerNodeHandler({
    moduleId: "flt_wi_mutex_group",
    handlerId: "flt_wi_mutex_group",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => ({
      outputs: {
        entries_out: filterImpls.filterWiMutexGroup(
          Array.isArray(inputs.entries_in) ? inputs.entries_in : [],
        ),
      },
      handlerId: "flt_wi_mutex_group",
    }),
  });

  registerNodeHandler({
    moduleId: "flt_mvu_strip",
    handlerId: "flt_mvu_strip",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      return {
        outputs: { text_out: await filterImpls.filterMvuStrip(text) },
        handlerId: "flt_mvu_strip",
      };
    },
  });

  registerNodeHandler({
    moduleId: "flt_mvu_detect",
    handlerId: "flt_mvu_detect",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      const result = filterImpls.filterMvuDetect(text);
      return {
        outputs: { text_out: result.text, is_mvu: result.isMvu },
        handlerId: "flt_mvu_detect",
      };
    },
  });

  registerNodeHandler({
    moduleId: "flt_blocked_content_strip",
    handlerId: "flt_blocked_content_strip",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      const blocked = Array.isArray(inputs.blocked) ? inputs.blocked : [];
      return {
        outputs: {
          text_out: filterImpls.filterBlockedContentStrip(text, blocked),
        },
        handlerId: "flt_blocked_content_strip",
      };
    },
  });

  registerNodeHandler({
    moduleId: "flt_regex_process",
    handlerId: "flt_regex_process",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      return {
        outputs: { text_out: filterImpls.filterRegexProcess(text) },
        handlerId: "flt_regex_process",
      };
    },
  });

  registerNodeHandler({
    moduleId: "flt_context_extract",
    handlerId: "flt_context_extract",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return {
        outputs: {
          msgs_out: filterImpls.filterContextExtract(
            msgs,
            node.config.rules ?? [],
          ),
        },
        handlerId: "flt_context_extract",
      };
    },
  });

  registerNodeHandler({
    moduleId: "flt_context_exclude",
    handlerId: "flt_context_exclude",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return {
        outputs: {
          msgs_out: filterImpls.filterContextExclude(
            msgs,
            node.config.rules ?? [],
          ),
        },
        handlerId: "flt_context_exclude",
      };
    },
  });

  registerNodeHandler({
    moduleId: "flt_custom_regex",
    handlerId: "flt_custom_regex",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      return {
        outputs: {
          text_out: filterImpls.filterCustomRegex(
            text,
            node.config.rules ?? [],
          ),
        },
        handlerId: "flt_custom_regex",
      };
    },
  });

  registerNodeHandler({
    moduleId: "flt_hide_messages",
    handlerId: "flt_hide_messages",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return {
        outputs: {
          msgs_out: filterImpls.filterHideMessages(msgs, node.config),
        },
        handlerId: "flt_hide_messages",
      };
    },
  });

  // ── Transform handlers ──
  registerNodeHandler({
    moduleId: "tfm_ejs_render",
    handlerId: "tfm_ejs_render",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const template =
        typeof inputs.template === "string" ? inputs.template : "";
      const ctx = inputs.context ?? {};
      return {
        outputs: {
          rendered: await transformImpls.transformEjsRender(template, ctx),
        },
        handlerId: "tfm_ejs_render",
      };
    },
  });

  registerNodeHandler({
    moduleId: "tfm_macro_replace",
    handlerId: "tfm_macro_replace",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      return {
        outputs: { text_out: transformImpls.transformMacroReplace(text) },
        handlerId: "tfm_macro_replace",
      };
    },
  });

  registerNodeHandler({
    moduleId: "tfm_controller_expand",
    handlerId: "tfm_controller_expand",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const entries = Array.isArray(inputs.controller) ? inputs.controller : [];
      return {
        outputs: {
          expanded: await transformImpls.transformControllerExpand(entries),
        },
        handlerId: "tfm_controller_expand",
      };
    },
  });

  registerNodeHandler({
    moduleId: "tfm_wi_bucket",
    handlerId: "tfm_wi_bucket",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const entries = Array.isArray(inputs.entries_in) ? inputs.entries_in : [];
      const buckets = transformImpls.transformWiBucket(entries);
      return {
        outputs: {
          before: buckets.before,
          after: buckets.after,
          at_depth: buckets.atDepth,
        },
        handlerId: "tfm_wi_bucket",
      };
    },
  });

  registerNodeHandler({
    moduleId: "tfm_entry_name_inject",
    handlerId: "tfm_entry_name_inject",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return {
        outputs: {
          msgs_out: transformImpls.transformEntryNameInject(
            msgs,
            inputs.snapshots,
          ),
        },
        handlerId: "tfm_entry_name_inject",
      };
    },
  });

  // ── Config handlers ──
  registerNodeHandler({
    moduleId: "cfg_api_preset",
    handlerId: "cfg_api_preset",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node }) => ({
      outputs: { config: { ...node.config } },
      handlerId: "cfg_api_preset",
    }),
  });

  registerNodeHandler({
    moduleId: "cfg_generation",
    handlerId: "cfg_generation",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node }) => ({
      outputs: { options: { ...node.config } },
      handlerId: "cfg_generation",
    }),
  });

  registerNodeHandler({
    moduleId: "cfg_behavior",
    handlerId: "cfg_behavior",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node }) => ({
      outputs: { options: { ...node.config } },
      handlerId: "cfg_behavior",
    }),
  });

  registerNodeHandler({
    moduleId: "cfg_timing",
    handlerId: "cfg_timing",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node }) => ({
      outputs: { timing: node.config.timing ?? "after_reply" },
      handlerId: "cfg_timing",
    }),
  });

  registerNodeHandler({
    moduleId: "cfg_system_prompt",
    handlerId: "cfg_system_prompt",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node }) => ({
      outputs: { prompt: node.config.content ?? "" },
      handlerId: "cfg_system_prompt",
    }),
  });

  // ── Compose handlers ──
  registerNodeHandler({
    moduleId: "cmp_prompt_order",
    handlerId: "cmp_prompt_order",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => ({
      outputs: {
        msgs_out: composeImpls.composePromptOrder(
          inputs.components ?? {},
          inputs.order ?? node.config.prompt_order ?? [],
        ),
      },
      handlerId: "cmp_prompt_order",
    }),
  });

  registerNodeHandler({
    moduleId: "cmp_depth_inject",
    handlerId: "cmp_depth_inject",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const msgs = Array.isArray(inputs.messages) ? inputs.messages : [];
      const injections = Array.isArray(inputs.injections)
        ? inputs.injections
        : [];
      return {
        outputs: {
          msgs_out: composeImpls.composeDepthInject(msgs, injections),
        },
        handlerId: "cmp_depth_inject",
      };
    },
  });

  registerNodeHandler({
    moduleId: "cmp_message_concat",
    handlerId: "cmp_message_concat",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => {
      const a = Array.isArray(inputs.a) ? inputs.a : [];
      const b = Array.isArray(inputs.b) ? inputs.b : [];
      return {
        outputs: { msgs_out: [...a, ...b] },
        handlerId: "cmp_message_concat",
      };
    },
  });

  registerNodeHandler({
    moduleId: "cmp_json_body_build",
    handlerId: "cmp_json_body_build",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => ({
      outputs: {
        body: composeImpls.composeJsonBodyBuild(
          inputs.context ?? {},
          inputs.config,
        ),
      },
      handlerId: "cmp_json_body_build",
    }),
  });

  registerNodeHandler({
    moduleId: "cmp_request_template",
    handlerId: "cmp_request_template",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => ({
      outputs: {
        result: composeImpls.composeRequestTemplate(
          inputs.body ?? {},
          typeof inputs.template === "string"
            ? inputs.template
            : (node.config.template ?? ""),
        ),
      },
      handlerId: "cmp_request_template",
    }),
  });

  registerNodeHandler({
    moduleId: "cmp_passthrough",
    handlerId: "cmp_passthrough",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => ({
      outputs: {
        value_out: inputs.value ?? null,
      },
      handlerId: "cmp_passthrough",
    }),
  });

  registerNodeHandler({
    moduleId: "cmp_value_equals",
    handlerId: "cmp_value_equals",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const normalizeComparable = (value: unknown): string => {
        if (value === null || value === undefined) {
          return "";
        }
        if (typeof value === "string") {
          return value;
        }
        if (typeof value === "number" || typeof value === "boolean") {
          return String(value);
        }
        if (Array.isArray(value)) {
          return value.map((entry) => normalizeComparable(entry)).join(",");
        }
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      };

      const normalizeText = (value: unknown): string => {
        let text = normalizeComparable(value);
        if (node.config.trim_whitespace !== false) {
          text = text.trim();
        }
        if (node.config.case_sensitive !== true) {
          text = text.toLowerCase();
        }
        return text;
      };

      const expectedCandidate =
        inputs.expected !== undefined ? inputs.expected : node.config.expected;
      const normalizedValue = normalizeText(inputs.value);
      const normalizedExpected = normalizeText(expectedCandidate);
      return {
        outputs: {
          matched: normalizedValue === normalizedExpected,
          normalized_value: normalizedValue,
          expected_value: normalizedExpected,
        },
        handlerId: "cmp_value_equals",
      };
    },
  });

  registerNodeHandler({
    moduleId: "cmp_text_concat",
    handlerId: "cmp_text_concat",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const normalizeText = (value: unknown): string => {
        if (typeof value === "string") {
          return value;
        }
        if (value === null || value === undefined) {
          return "";
        }
        if (typeof value === "number" || typeof value === "boolean") {
          return String(value);
        }
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      };

      const parts = [normalizeText(inputs.a), normalizeText(inputs.b)];
      const separatorCandidate =
        typeof inputs.separator === "string"
          ? inputs.separator
          : normalizeText(node.config.separator ?? "\n");
      const joinableParts =
        node.config.skip_empty !== false
          ? parts.filter((part) => part.length > 0)
          : parts;
      return {
        outputs: {
          text_out: joinableParts.join(separatorCandidate),
        },
        handlerId: "cmp_text_concat",
      };
    },
  });

  registerNodeHandler({
    moduleId: "ctl_if",
    handlerId: "ctl_if",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const normalizeTruthy = (value: unknown): boolean => {
        if (Array.isArray(value)) {
          return value.some((entry) => normalizeTruthy(entry));
        }
        if (typeof value === "boolean") {
          return value;
        }
        if (typeof value === "number") {
          return Number.isFinite(value) && value !== 0;
        }
        if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          if (!normalized || normalized === "false" || normalized === "0") {
            return false;
          }
          return true;
        }
        return value !== null && value !== undefined;
      };

      const baseCondition = normalizeTruthy(inputs.condition);
      const activeThen =
        node.config.negate === true ? !baseCondition : baseCondition;
      return {
        outputs: {
          then: activeThen,
          else: !activeThen,
          selected_branch: activeThen ? "then" : "else",
        },
        handlerId: "ctl_if",
      };
    },
  });

  registerNodeHandler({
    moduleId: "ctl_join",
    handlerId: "ctl_join",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs, inputSources, configuredInputEdgeCounts }) => {
      const normalizeTruthy = (value: unknown): boolean => {
        if (Array.isArray(value)) {
          return value.some((entry) => normalizeTruthy(entry));
        }
        if (typeof value === "boolean") {
          return value;
        }
        if (typeof value === "number") {
          return Number.isFinite(value) && value !== 0;
        }
        if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          if (!normalized || normalized === "false" || normalized === "0") {
            return false;
          }
          return true;
        }
        return value !== null && value !== undefined;
      };

      const branchSignals = Array.isArray(inputs.branches)
        ? inputs.branches
        : inputs.branches === undefined
          ? []
          : [inputs.branches];
      const observedBranchCount = inputSources.filter(
        (source) => source.targetPort === "branches",
      ).length;
      const configuredBranchCount = Math.max(
        0,
        Math.trunc(Number(configuredInputEdgeCounts.branches ?? 0) || 0),
      );
      const truthyBranches = branchSignals.filter((value) =>
        normalizeTruthy(value),
      ).length;
      const mode = node.config.mode === "any" ? "any" : "all";
      const joined =
        mode === "any"
          ? truthyBranches > 0
          : configuredBranchCount > 0 &&
            observedBranchCount === configuredBranchCount &&
            truthyBranches === configuredBranchCount;
      return {
        outputs: {
          joined,
          joined_count: truthyBranches,
          pending_count: Math.max(
            0,
            configuredBranchCount - observedBranchCount,
          ),
          mode,
        },
        handlerId: "ctl_join",
      };
    },
  });

  // ── Execute handlers ──
  registerNodeHandler({
    moduleId: "exe_llm_call",
    handlerId: "exe_llm_call",
    kind: "builtin",
    capability: "network",
    sideEffect: "unknown",
    execute: async ({ node, inputs, context }) => {
      const msgs = Array.isArray(inputs.messages) ? inputs.messages : [];
      const apiCfg = inputs.api_config ?? node.config;
      const genOpts = inputs.gen_options ?? {};
      const behavior = inputs.behavior ?? {};
      return {
        outputs: {
          raw_response: await executeImpls.executeLlmCall(
            msgs,
            apiCfg,
            genOpts,
            behavior,
            context.abortSignal,
          ),
        },
        handlerId: "exe_llm_call",
        capability: "network",
      };
    },
  });

  registerNodeHandler({
    moduleId: "exe_response_extract",
    handlerId: "exe_response_extract",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const raw = typeof inputs.raw === "string" ? inputs.raw : "";
      return {
        outputs: {
          extracted: executeImpls.executeResponseExtract(
            raw,
            node.config.pattern ?? "",
          ),
        },
        handlerId: "exe_response_extract",
      };
    },
  });

  registerNodeHandler({
    moduleId: "exe_response_remove",
    handlerId: "exe_response_remove",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const raw = typeof inputs.raw === "string" ? inputs.raw : "";
      return {
        outputs: {
          cleaned: executeImpls.executeResponseRemove(
            raw,
            node.config.pattern ?? "",
          ),
        },
        handlerId: "exe_response_remove",
      };
    },
  });

  registerNodeHandler({
    moduleId: "exe_json_parse",
    handlerId: "exe_json_parse",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ node, inputs }) => {
      const text = typeof inputs.text === "string" ? inputs.text : "";
      if (!text.trim()) {
        return { outputs: { parsed: {} }, handlerId: "exe_json_parse" };
      }
      try {
        return {
          outputs: { parsed: JSON.parse(text.trim()) },
          handlerId: "exe_json_parse",
        };
      } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) {
          try {
            return {
              outputs: { parsed: JSON.parse(text.slice(start, end + 1)) },
              handlerId: "exe_json_parse",
            };
          } catch {
            /* fall */
          }
        }
        console.warn(`[GraphExecutor] Node ${node.id}: failed to parse JSON`);
        return { outputs: { parsed: {} }, handlerId: "exe_json_parse" };
      }
    },
  });

  registerNodeHandler({
    moduleId: "exe_response_normalize",
    handlerId: "exe_response_normalize",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => ({
      outputs: {
        normalized: executeImpls.executeResponseNormalize(inputs.raw ?? {}),
      },
      handlerId: "exe_response_normalize",
    }),
  });

  registerNodeHandler({
    moduleId: "exe_stream_sse",
    handlerId: "exe_stream_sse",
    kind: "builtin",
    sideEffect: "pure",
    execute: async ({ inputs }) => ({
      outputs: {
        full_text: await executeImpls.executeStreamSse(inputs.response),
      },
      handlerId: "exe_stream_sse",
    }),
  });

  // ── Output handlers ──
  registerNodeHandler({
    moduleId: "out_worldbook_write",
    handlerId: "out_worldbook_write",
    kind: "builtin",
    sideEffect: "writes_host",
    execute: async ({ inputs }) => {
      const ops = Array.isArray(inputs.operations) ? inputs.operations : [];
      await outputImpls.outputWorldbookWrite(ops);
      return { outputs: {}, handlerId: "out_worldbook_write" };
    },
  });

  registerNodeHandler({
    moduleId: "out_floor_bind",
    handlerId: "out_floor_bind",
    kind: "builtin",
    sideEffect: "writes_host",
    execute: async ({ inputs }) => {
      await outputImpls.outputFloorBind(inputs.result ?? {}, inputs.message_id);
      return { outputs: {}, handlerId: "out_floor_bind" };
    },
  });

  registerNodeHandler({
    moduleId: "out_snapshot_save",
    handlerId: "out_snapshot_save",
    kind: "builtin",
    sideEffect: "writes_host",
    execute: async ({ node, inputs }) => {
      await outputImpls.outputSnapshotSave(inputs.snapshot ?? {}, node.config);
      return { outputs: {}, handlerId: "out_snapshot_save" };
    },
  });

  registerNodeHandler({
    moduleId: "out_reply_inject",
    handlerId: "out_reply_inject",
    kind: "builtin",
    sideEffect: "writes_host",
    execute: async ({ inputs }) => {
      outputImpls.outputReplyInject(
        typeof inputs.instruction === "string" ? inputs.instruction : "",
      );
      return { outputs: {}, handlerId: "out_reply_inject" };
    },
    produceHostWriteDescriptors: () => [
      {
        kind: "host_write",
        targetType: "reply_instruction",
        targetId: undefined,
        operation: "inject_reply_instruction",
        path: "reply.instruction",
        idempotency: "non_idempotent",
        retryable: false,
      },
    ],
    produceHostCommitContracts: (hostWrites) =>
      hostWrites.map(createHostCommitContractFromDescriptor),
  });

  registerNodeHandler({
    moduleId: "out_merge_results",
    handlerId: "out_merge_results",
    kind: "builtin",
    sideEffect: "writes_host",
    execute: async ({ inputs }) => {
      const results = Array.isArray(inputs.results) ? inputs.results : [];
      return {
        outputs: { merged_plan: outputImpls.outputMergeResults(results) },
        handlerId: "out_merge_results",
      };
    },
  });

  _initialized = true;
}

/**
 * Ensure built-in handlers are registered.
 * Safe to call multiple times — only initializes once per module set.
 */
export function ensureBuiltinHandlers(modules: RuntimeImplModules): void {
  if (!_initialized) {
    registerBuiltinHandlers(modules);
  }
}

/**
 * Reset the registry (for testing only).
 */
export function _resetRegistryForTesting(): void {
  _descriptors.clear();
  _initialized = false;
}
