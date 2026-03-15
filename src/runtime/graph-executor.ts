/* ═══ Module Workbench — Graph Execution Engine ═══ */
/*
 * Executes a WorkbenchGraph by:
 *   1. Topological sort of nodes
 *   2. Per-node execution with input collection from upstream edges
 *   3. Module dispatch to the appropriate runtime function
 *
 * This is the core that replaces the fixed pipeline with graph-driven execution.
 */

import type {
  WorkbenchGraph,
  WorkbenchNode,
  WorkbenchEdge,
  ExecutionContext,
  ModuleExecutionResult,
  GraphExecutionResult,
  ModuleOutput,
} from '../ui/components/graph/module-types';
import { getModuleBlueprint } from '../ui/components/graph/module-registry';

// ── Topological Sort ──

interface SortedNode {
  node: WorkbenchNode;
  /** Indices of nodes that this node depends on (upstream) */
  dependsOn: number[];
}

/**
 * Kahn's algorithm for topological sort.
 * Returns nodes in execution order. Throws on cycles.
 */
export function topologicalSort(
  nodes: WorkbenchNode[],
  edges: WorkbenchEdge[],
): SortedNode[] {
  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, i) => nodeIndex.set(n.id, i));

  // Build adjacency: inDegree and dependsOn
  const inDegree = new Array(nodes.length).fill(0);
  const dependsOn: number[][] = nodes.map(() => []);
  const downstream: number[][] = nodes.map(() => []);

  for (const edge of edges) {
    const srcIdx = nodeIndex.get(edge.source);
    const tgtIdx = nodeIndex.get(edge.target);
    if (srcIdx === undefined || tgtIdx === undefined) continue;
    inDegree[tgtIdx]++;
    dependsOn[tgtIdx].push(srcIdx);
    downstream[srcIdx].push(tgtIdx);
  }

  // Kahn's: start with zero in-degree nodes
  const queue: number[] = [];
  for (let i = 0; i < inDegree.length; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const sorted: SortedNode[] = [];
  while (queue.length > 0) {
    const idx = queue.shift()!;
    sorted.push({ node: nodes[idx], dependsOn: dependsOn[idx] });
    for (const dIdx of downstream[idx]) {
      inDegree[dIdx]--;
      if (inDegree[dIdx] === 0) queue.push(dIdx);
    }
  }

  if (sorted.length !== nodes.length) {
    const remaining = nodes
      .filter((_, i) => inDegree[i] > 0)
      .map(n => n.id)
      .join(', ');
    throw new Error(`图中存在循环依赖，无法排序执行。涉及节点: ${remaining}`);
  }

  return sorted;
}

// ── Input Collection ──

/**
 * For a given node, collect all inputs from upstream edges.
 * Returns a map of { targetPortId → data } sourced from upstream node outputs.
 */
function collectNodeInputs(
  node: WorkbenchNode,
  edges: WorkbenchEdge[],
  nodeOutputs: Map<string, ModuleOutput>,
): Record<string, any> {
  const inputs: Record<string, any> = {};

  for (const edge of edges) {
    if (edge.target !== node.id) continue;

    const upstream = nodeOutputs.get(edge.source);
    if (!upstream) continue;

    const value = upstream[edge.sourcePort];
    if (value === undefined) continue;

    // If this port already has a value (multiple connections), merge into array
    if (inputs[edge.targetPort] !== undefined) {
      if (Array.isArray(inputs[edge.targetPort])) {
        inputs[edge.targetPort].push(value);
      } else {
        inputs[edge.targetPort] = [inputs[edge.targetPort], value];
      }
    } else {
      inputs[edge.targetPort] = value;
    }
  }

  return inputs;
}

// ── Module Execution Dispatch ──

/**
 * Execute a single module node.
 *
 * Each module is dispatched to the appropriate runtime function based on its moduleId.
 * The module receives:
 *   - inputs: data from upstream edges
 *   - config: per-instance configuration
 *   - context: global execution context (settings, abort, etc.)
 *
 * Returns the module's outputs keyed by output port ID.
 *
 * NOTE: In Iteration 2, only a subset of critical modules are implemented.
 * Others return pass-through or empty outputs.
 * Full implementation will be added in Iterations 4-5.
 */
async function executeModule(
  node: WorkbenchNode,
  inputs: Record<string, any>,
  context: ExecutionContext,
): Promise<ModuleOutput> {
  const moduleId = node.moduleId;
  const config = node.config;

  switch (moduleId) {
    // ═══════ Source modules ═══════
    case 'src_char_fields': {
      const { collectCharFields } = await import('./module-impls/source-impls');
      return collectCharFields();
    }
    case 'src_chat_history': {
      const { collectChatHistory } = await import('./module-impls/source-impls');
      return { messages: collectChatHistory(config.context_turns ?? 8) };
    }
    case 'src_worldbook_raw': {
      const { collectWorldbookRaw } = await import('./module-impls/source-impls');
      return { entries: collectWorldbookRaw(config) };
    }
    case 'src_extension_prompts': {
      const { collectExtensionPrompts } = await import('./module-impls/source-impls');
      return collectExtensionPrompts();
    }
    case 'src_user_input':
      return { text: context.userInput ?? '' };
    case 'src_flow_context': {
      const { collectFlowContext } = await import('./module-impls/source-impls');
      return { context: collectFlowContext(context) };
    }
    case 'src_serial_results': {
      const { collectSerialResults } = await import('./module-impls/source-impls');
      return { results: collectSerialResults((context as any).previousResults) };
    }

    // ═══════ Filter modules ═══════
    case 'flt_wi_keyword_match': {
      const { filterWiKeywordMatch } = await import('./module-impls/filter-impls');
      const entries = Array.isArray(inputs.entries) ? inputs.entries : [];
      const chatTexts = typeof inputs.chat_texts === 'string'
        ? inputs.chat_texts
        : Array.isArray(inputs.chat_texts)
          ? inputs.chat_texts.map((m: any) => m.content ?? '').join('\n')
          : '';
      return { activated: filterWiKeywordMatch(entries, chatTexts) };
    }
    case 'flt_wi_probability': {
      const { filterWiProbability } = await import('./module-impls/filter-impls');
      return { entries_out: filterWiProbability(Array.isArray(inputs.entries_in) ? inputs.entries_in : []) };
    }
    case 'flt_wi_mutex_group': {
      const { filterWiMutexGroup } = await import('./module-impls/filter-impls');
      return { entries_out: filterWiMutexGroup(Array.isArray(inputs.entries_in) ? inputs.entries_in : []) };
    }
    case 'flt_mvu_strip': {
      const { filterMvuStrip } = await import('./module-impls/filter-impls');
      const text = typeof inputs.text_in === 'string' ? inputs.text_in : '';
      return { text_out: await filterMvuStrip(text) };
    }
    case 'flt_mvu_detect': {
      const { filterMvuDetect } = await import('./module-impls/filter-impls');
      const text = typeof inputs.text_in === 'string' ? inputs.text_in : '';
      const result = filterMvuDetect(text);
      return { text_out: result.text, is_mvu: result.isMvu };
    }
    case 'flt_blocked_content_strip': {
      const { filterBlockedContentStrip } = await import('./module-impls/filter-impls');
      const text = typeof inputs.text_in === 'string' ? inputs.text_in : '';
      const blocked = Array.isArray(inputs.blocked) ? inputs.blocked : [];
      return { text_out: filterBlockedContentStrip(text, blocked) };
    }
    case 'flt_regex_process': {
      const { filterRegexProcess } = await import('./module-impls/filter-impls');
      const text = typeof inputs.text_in === 'string' ? inputs.text_in : '';
      return { text_out: filterRegexProcess(text) };
    }
    case 'flt_context_extract': {
      const { filterContextExtract } = await import('./module-impls/filter-impls');
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return { msgs_out: filterContextExtract(msgs, config.rules ?? []) };
    }
    case 'flt_context_exclude': {
      const { filterContextExclude } = await import('./module-impls/filter-impls');
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return { msgs_out: filterContextExclude(msgs, config.rules ?? []) };
    }
    case 'flt_custom_regex': {
      const { filterCustomRegex } = await import('./module-impls/filter-impls');
      const text = typeof inputs.text_in === 'string' ? inputs.text_in : '';
      return { text_out: filterCustomRegex(text, config.rules ?? []) };
    }
    case 'flt_hide_messages': {
      const { filterHideMessages } = await import('./module-impls/filter-impls');
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return { msgs_out: filterHideMessages(msgs, config) };
    }

    // ═══════ Transform modules ═══════
    case 'tfm_ejs_render': {
      const { transformEjsRender } = await import('./module-impls/transform-impls');
      const template = typeof inputs.template === 'string' ? inputs.template : '';
      const ctx = inputs.context ?? {};
      return { rendered: await transformEjsRender(template, ctx) };
    }
    case 'tfm_macro_replace': {
      const { transformMacroReplace } = await import('./module-impls/transform-impls');
      const text = typeof inputs.text_in === 'string' ? inputs.text_in : '';
      return { text_out: transformMacroReplace(text) };
    }
    case 'tfm_controller_expand': {
      const { transformControllerExpand } = await import('./module-impls/transform-impls');
      const entries = Array.isArray(inputs.controller) ? inputs.controller : [];
      return { expanded: await transformControllerExpand(entries) };
    }
    case 'tfm_wi_bucket': {
      const { transformWiBucket } = await import('./module-impls/transform-impls');
      const entries = Array.isArray(inputs.entries_in) ? inputs.entries_in : [];
      const buckets = transformWiBucket(entries);
      return { before: buckets.before, after: buckets.after, at_depth: buckets.atDepth };
    }
    case 'tfm_entry_name_inject': {
      const { transformEntryNameInject } = await import('./module-impls/transform-impls');
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return { msgs_out: transformEntryNameInject(msgs, inputs.snapshots) };
    }

    // ═══════ Config modules (pure output, no execution) ═══════
    case 'cfg_api_preset':
      return { config: { ...config } };
    case 'cfg_generation':
      return { options: { ...config } };
    case 'cfg_behavior':
      return { options: { ...config } };
    case 'cfg_timing':
      return { timing: config.timing ?? 'after_reply' };
    case 'cfg_system_prompt':
      return { prompt: config.content ?? '' };

    // ═══════ Compose modules ═══════
    case 'cmp_prompt_order': {
      const { composePromptOrder } = await import('./module-impls/compose-impls');
      const components = inputs.components ?? {};
      const order = inputs.order ?? config.prompt_order ?? [];
      return { msgs_out: composePromptOrder(components, order) };
    }
    case 'cmp_depth_inject': {
      const { composeDepthInject } = await import('./module-impls/compose-impls');
      const msgs = Array.isArray(inputs.messages) ? inputs.messages : [];
      const injections = Array.isArray(inputs.injections) ? inputs.injections : [];
      return { msgs_out: composeDepthInject(msgs, injections) };
    }
    case 'cmp_message_concat': {
      const a = Array.isArray(inputs.a) ? inputs.a : [];
      const b = Array.isArray(inputs.b) ? inputs.b : [];
      return { msgs_out: [...a, ...b] };
    }
    case 'cmp_json_body_build': {
      const { composeJsonBodyBuild } = await import('./module-impls/compose-impls');
      return { body: composeJsonBodyBuild(inputs.context ?? {}, inputs.config) };
    }
    case 'cmp_request_template': {
      const { composeRequestTemplate } = await import('./module-impls/compose-impls');
      const body = inputs.body ?? {};
      const template = typeof inputs.template === 'string' ? inputs.template : config.template ?? '';
      return { result: composeRequestTemplate(body, template) };
    }

    // ═══════ Execute modules ═══════
    case 'exe_llm_call': {
      const { executeLlmCall } = await import('./module-impls/execute-impls');
      const msgs = Array.isArray(inputs.messages) ? inputs.messages : [];
      const apiCfg = inputs.api_config ?? config;
      const genOpts = inputs.gen_options ?? {};
      const behavior = inputs.behavior ?? {};
      return { raw_response: await executeLlmCall(msgs, apiCfg, genOpts, behavior) };
    }
    case 'exe_response_extract': {
      const { executeResponseExtract } = await import('./module-impls/execute-impls');
      const raw = typeof inputs.raw === 'string' ? inputs.raw : '';
      return { extracted: executeResponseExtract(raw, config.pattern ?? '') };
    }
    case 'exe_response_remove': {
      const { executeResponseRemove } = await import('./module-impls/execute-impls');
      const raw = typeof inputs.raw === 'string' ? inputs.raw : '';
      return { cleaned: executeResponseRemove(raw, config.pattern ?? '') };
    }
    case 'exe_json_parse': {
      const text = typeof inputs.text === 'string' ? inputs.text : '';
      if (!text.trim()) return { parsed: {} };
      try {
        return { parsed: JSON.parse(text.trim()) };
      } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
          try { return { parsed: JSON.parse(text.slice(start, end + 1)) }; } catch { /* fall */ }
        }
        console.warn(`[GraphExecutor] Node ${node.id}: failed to parse JSON`);
        return { parsed: {} };
      }
    }
    case 'exe_response_normalize': {
      const { executeResponseNormalize } = await import('./module-impls/execute-impls');
      const raw = inputs.raw ?? {};
      return { normalized: executeResponseNormalize(raw) };
    }
    case 'exe_stream_sse': {
      const { executeStreamSse } = await import('./module-impls/execute-impls');
      return { full_text: await executeStreamSse(inputs.response) };
    }

    // ═══════ Output modules ═══════
    case 'out_worldbook_write': {
      const { outputWorldbookWrite } = await import('./module-impls/output-impls');
      const ops = Array.isArray(inputs.operations) ? inputs.operations : [];
      await outputWorldbookWrite(ops);
      return {};
    }
    case 'out_floor_bind': {
      const { outputFloorBind } = await import('./module-impls/output-impls');
      await outputFloorBind(inputs.result ?? {}, inputs.message_id);
      return {};
    }
    case 'out_snapshot_save': {
      const { outputSnapshotSave } = await import('./module-impls/output-impls');
      await outputSnapshotSave(inputs.snapshot ?? {}, config);
      return {};
    }
    case 'out_reply_inject': {
      const { outputReplyInject } = await import('./module-impls/output-impls');
      outputReplyInject(typeof inputs.instruction === 'string' ? inputs.instruction : '');
      return {};
    }
    case 'out_merge_results': {
      const { outputMergeResults } = await import('./module-impls/output-impls');
      const results = Array.isArray(inputs.results) ? inputs.results : [];
      return { merged_plan: outputMergeResults(results) };
    }

    // ═══════ Fallback: pass-through ═══════
    default: {
      const blueprint = getModuleBlueprint(moduleId);
      const outPorts = blueprint.ports.filter(p => p.direction === 'out');
      if (outPorts.length > 0) {
        const firstInValue = Object.values(inputs)[0];
        const result: ModuleOutput = {};
        for (const port of outPorts) {
          result[port.id] = firstInValue ?? null;
        }
        return result;
      }
      return {};
    }
  }
}

// ── Main Executor ──

export async function executeGraph(
  graph: WorkbenchGraph,
  context: ExecutionContext,
): Promise<GraphExecutionResult> {
  const startedAt = Date.now();
  const moduleResults: ModuleExecutionResult[] = [];
  const nodeOutputs = new Map<string, ModuleOutput>();

  try {
    // 1. Topological sort
    const sorted = topologicalSort(graph.nodes, graph.edges);

    // 2. Execute each node in order
    for (const { node } of sorted) {
      if (context.abortSignal?.aborted || context.isCancelled?.()) {
        throw new Error('workflow cancelled by user');
      }

      const nodeStart = Date.now();
      const inputs = collectNodeInputs(node, graph.edges, nodeOutputs);

      context.onProgress?.({
        phase: 'module_executing',
        request_id: context.requestId,
        module_id: node.moduleId,
        node_id: node.id,
        message: `正在执行模块「${getModuleBlueprint(node.moduleId).label}」…`,
      });

      try {
        const outputs = await executeModule(node, inputs, context);
        nodeOutputs.set(node.id, outputs);

        moduleResults.push({
          nodeId: node.id,
          moduleId: node.moduleId,
          outputs,
          elapsedMs: Date.now() - nodeStart,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        moduleResults.push({
          nodeId: node.id,
          moduleId: node.moduleId,
          outputs: {},
          elapsedMs: Date.now() - nodeStart,
          error: errorMsg,
        });

        // For now, fail fast. In the future, we could support
        // error handling strategies per-node.
        throw new Error(`模块「${getModuleBlueprint(node.moduleId).label}」执行失败: ${errorMsg}`);
      }
    }

    // 3. Collect final outputs (from all terminal nodes = no outgoing edges)
    const nodesWithOutgoing = new Set(graph.edges.map(e => e.source));
    const terminalOutputs: Record<string, any> = {};
    for (const node of graph.nodes) {
      if (!nodesWithOutgoing.has(node.id)) {
        const outputs = nodeOutputs.get(node.id);
        if (outputs) {
          terminalOutputs[node.id] = outputs;
        }
      }
    }

    return {
      ok: true,
      requestId: context.requestId,
      moduleResults,
      finalOutputs: terminalOutputs,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      requestId: context.requestId,
      moduleResults,
      finalOutputs: {},
      elapsedMs: Date.now() - startedAt,
    };
  }
}

// ── Utility: validate graph before execution ──

export interface GraphValidationError {
  nodeId?: string;
  message: string;
}

export function validateGraph(graph: WorkbenchGraph): GraphValidationError[] {
  const errors: GraphValidationError[] = [];
  const nodeIds = new Set(graph.nodes.map(n => n.id));

  // Check that all edge references exist
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({ message: `连线引用了不存在的源节点: ${edge.source}` });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ message: `连线引用了不存在的目标节点: ${edge.target}` });
    }
  }

  // Check that all nodes reference valid module IDs
  for (const node of graph.nodes) {
    try {
      getModuleBlueprint(node.moduleId);
    } catch {
      errors.push({
        nodeId: node.id,
        message: `节点引用了未知的模块类型: ${node.moduleId}`,
      });
    }
  }

  // Check for cycles
  try {
    topologicalSort(graph.nodes, graph.edges);
  } catch {
    errors.push({ message: '图中存在循环依赖' });
  }

  // Check required ports are connected
  for (const node of graph.nodes) {
    try {
      const bp = getModuleBlueprint(node.moduleId);
      const requiredInPorts = bp.ports.filter(p => p.direction === 'in' && !p.optional);
      for (const port of requiredInPorts) {
        const hasConnection = graph.edges.some(
          e => e.target === node.id && e.targetPort === port.id,
        );
        if (!hasConnection) {
          errors.push({
            nodeId: node.id,
            message: `模块「${bp.label}」的必要输入端口「${port.label}」未连接`,
          });
        }
      }
    } catch {
      // Already reported above
    }
  }

  return errors;
}
