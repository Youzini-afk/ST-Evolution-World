/* ═══ Module Workbench — Graph Execution Engine ═══ */
/*
 * Executes a WorkbenchGraph by:
 *   1. Topological sort of nodes
 *   2. Per-node execution with input collection from upstream edges
 *   3. Module dispatch to the appropriate runtime function
 *
 * This is the core that replaces the fixed pipeline with graph-driven execution.
 */

import { getModuleBlueprint } from "../ui/components/graph/module-registry";
import type {
  ExecutionContext,
  GraphExecutionResult,
  ModuleExecutionResult,
  ModuleOutput,
  ModulePortDef,
  PortDataType,
  WorkbenchEdge,
  WorkbenchGraph,
  WorkbenchNode,
} from "../ui/components/graph/module-types";

type SourceImpls = typeof import("./module-impls/source-impls");
type FilterImpls = typeof import("./module-impls/filter-impls");
type TransformImpls = typeof import("./module-impls/transform-impls");
type ComposeImpls = typeof import("./module-impls/compose-impls");
type ExecuteImpls = typeof import("./module-impls/execute-impls");
type OutputImpls = typeof import("./module-impls/output-impls");

interface RuntimeImplModules {
  sourceImpls: SourceImpls;
  filterImpls: FilterImpls;
  transformImpls: TransformImpls;
  composeImpls: ComposeImpls;
  executeImpls: ExecuteImpls;
  outputImpls: OutputImpls;
}

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
      .map((n) => n.id)
      .join(", ");
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
  modules: RuntimeImplModules,
): Promise<ModuleOutput> {
  const moduleId = node.moduleId;
  const config = node.config;
  const {
    sourceImpls,
    filterImpls,
    transformImpls,
    composeImpls,
    executeImpls,
    outputImpls,
  } = modules;

  switch (moduleId) {
    // ═══════ Source modules ═══════
    case "src_char_fields":
      return sourceImpls.collectCharFields();
    case "src_chat_history":
      return {
        messages: sourceImpls.collectChatHistory(config.context_turns ?? 8),
      };
    case "src_worldbook_raw":
      return { entries: sourceImpls.collectWorldbookRaw(config) };
    case "src_extension_prompts":
      return sourceImpls.collectExtensionPrompts();
    case "src_user_input":
      return { text: context.userInput ?? "" };
    case "src_flow_context":
      return { context: sourceImpls.collectFlowContext(context) };
    case "src_serial_results":
      return {
        results: sourceImpls.collectSerialResults(
          (context as any).previousResults,
        ),
      };

    // ═══════ Filter modules ═══════
    case "flt_wi_keyword_match": {
      const entries = Array.isArray(inputs.entries) ? inputs.entries : [];
      const chatTexts =
        typeof inputs.chat_texts === "string"
          ? inputs.chat_texts
          : Array.isArray(inputs.chat_texts)
            ? inputs.chat_texts.map((m: any) => m.content ?? "").join("\n")
            : "";
      return {
        activated: filterImpls.filterWiKeywordMatch(entries, chatTexts),
      };
    }
    case "flt_wi_probability":
      return {
        entries_out: filterImpls.filterWiProbability(
          Array.isArray(inputs.entries_in) ? inputs.entries_in : [],
        ),
      };
    case "flt_wi_mutex_group":
      return {
        entries_out: filterImpls.filterWiMutexGroup(
          Array.isArray(inputs.entries_in) ? inputs.entries_in : [],
        ),
      };
    case "flt_mvu_strip": {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      return { text_out: await filterImpls.filterMvuStrip(text) };
    }
    case "flt_mvu_detect": {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      const result = filterImpls.filterMvuDetect(text);
      return { text_out: result.text, is_mvu: result.isMvu };
    }
    case "flt_blocked_content_strip": {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      const blocked = Array.isArray(inputs.blocked) ? inputs.blocked : [];
      return { text_out: filterImpls.filterBlockedContentStrip(text, blocked) };
    }
    case "flt_regex_process": {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      return { text_out: filterImpls.filterRegexProcess(text) };
    }
    case "flt_context_extract": {
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return {
        msgs_out: filterImpls.filterContextExtract(msgs, config.rules ?? []),
      };
    }
    case "flt_context_exclude": {
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return {
        msgs_out: filterImpls.filterContextExclude(msgs, config.rules ?? []),
      };
    }
    case "flt_custom_regex": {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      return {
        text_out: filterImpls.filterCustomRegex(text, config.rules ?? []),
      };
    }
    case "flt_hide_messages": {
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return { msgs_out: filterImpls.filterHideMessages(msgs, config) };
    }

    // ═══════ Transform modules ═══════
    case "tfm_ejs_render": {
      const template =
        typeof inputs.template === "string" ? inputs.template : "";
      const ctx = inputs.context ?? {};
      return {
        rendered: await transformImpls.transformEjsRender(template, ctx),
      };
    }
    case "tfm_macro_replace": {
      const text = typeof inputs.text_in === "string" ? inputs.text_in : "";
      return { text_out: transformImpls.transformMacroReplace(text) };
    }
    case "tfm_controller_expand": {
      const entries = Array.isArray(inputs.controller) ? inputs.controller : [];
      return {
        expanded: await transformImpls.transformControllerExpand(entries),
      };
    }
    case "tfm_wi_bucket": {
      const entries = Array.isArray(inputs.entries_in) ? inputs.entries_in : [];
      const buckets = transformImpls.transformWiBucket(entries);
      return {
        before: buckets.before,
        after: buckets.after,
        at_depth: buckets.atDepth,
      };
    }
    case "tfm_entry_name_inject": {
      const msgs = Array.isArray(inputs.msgs_in) ? inputs.msgs_in : [];
      return {
        msgs_out: transformImpls.transformEntryNameInject(
          msgs,
          inputs.snapshots,
        ),
      };
    }

    // ═══════ Config modules (pure output, no execution) ═══════
    case "cfg_api_preset":
      return { config: { ...config } };
    case "cfg_generation":
      return { options: { ...config } };
    case "cfg_behavior":
      return { options: { ...config } };
    case "cfg_timing":
      return { timing: config.timing ?? "after_reply" };
    case "cfg_system_prompt":
      return { prompt: config.content ?? "" };

    // ═══════ Compose modules ═══════
    case "cmp_prompt_order": {
      const components = inputs.components ?? {};
      const order = inputs.order ?? config.prompt_order ?? [];
      return { msgs_out: composeImpls.composePromptOrder(components, order) };
    }
    case "cmp_depth_inject": {
      const msgs = Array.isArray(inputs.messages) ? inputs.messages : [];
      const injections = Array.isArray(inputs.injections)
        ? inputs.injections
        : [];
      return { msgs_out: composeImpls.composeDepthInject(msgs, injections) };
    }
    case "cmp_message_concat": {
      const a = Array.isArray(inputs.a) ? inputs.a : [];
      const b = Array.isArray(inputs.b) ? inputs.b : [];
      return { msgs_out: [...a, ...b] };
    }
    case "cmp_json_body_build":
      return {
        body: composeImpls.composeJsonBodyBuild(
          inputs.context ?? {},
          inputs.config,
        ),
      };
    case "cmp_request_template": {
      const body = inputs.body ?? {};
      const template =
        typeof inputs.template === "string"
          ? inputs.template
          : (config.template ?? "");
      return { result: composeImpls.composeRequestTemplate(body, template) };
    }

    // ═══════ Execute modules ═══════
    case "exe_llm_call": {
      const msgs = Array.isArray(inputs.messages) ? inputs.messages : [];
      const apiCfg = inputs.api_config ?? config;
      const genOpts = inputs.gen_options ?? {};
      const behavior = inputs.behavior ?? {};
      return {
        raw_response: await executeImpls.executeLlmCall(
          msgs,
          apiCfg,
          genOpts,
          behavior,
          context.abortSignal,
        ),
      };
    }
    case "exe_response_extract": {
      const raw = typeof inputs.raw === "string" ? inputs.raw : "";
      return {
        extracted: executeImpls.executeResponseExtract(
          raw,
          config.pattern ?? "",
        ),
      };
    }
    case "exe_response_remove": {
      const raw = typeof inputs.raw === "string" ? inputs.raw : "";
      return {
        cleaned: executeImpls.executeResponseRemove(raw, config.pattern ?? ""),
      };
    }
    case "exe_json_parse": {
      const text = typeof inputs.text === "string" ? inputs.text : "";
      if (!text.trim()) return { parsed: {} };
      try {
        return { parsed: JSON.parse(text.trim()) };
      } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) {
          try {
            return { parsed: JSON.parse(text.slice(start, end + 1)) };
          } catch {
            /* fall */
          }
        }
        console.warn(`[GraphExecutor] Node ${node.id}: failed to parse JSON`);
        return { parsed: {} };
      }
    }
    case "exe_response_normalize": {
      const raw = inputs.raw ?? {};
      return { normalized: executeImpls.executeResponseNormalize(raw) };
    }
    case "exe_stream_sse":
      return {
        full_text: await executeImpls.executeStreamSse(inputs.response),
      };

    // ═══════ Output modules ═══════
    case "out_worldbook_write": {
      const ops = Array.isArray(inputs.operations) ? inputs.operations : [];
      await outputImpls.outputWorldbookWrite(ops);
      return {};
    }
    case "out_floor_bind":
      await outputImpls.outputFloorBind(inputs.result ?? {}, inputs.message_id);
      return {};
    case "out_snapshot_save":
      await outputImpls.outputSnapshotSave(inputs.snapshot ?? {}, config);
      return {};
    case "out_reply_inject":
      outputImpls.outputReplyInject(
        typeof inputs.instruction === "string" ? inputs.instruction : "",
      );
      return {};
    case "out_merge_results": {
      const results = Array.isArray(inputs.results) ? inputs.results : [];
      return { merged_plan: outputImpls.outputMergeResults(results) };
    }

    // ═══════ Fallback: pass-through ═══════
    default: {
      const blueprint = getModuleBlueprint(moduleId);
      const outPorts = blueprint.ports.filter((p) => p.direction === "out");
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
  const validationErrors = validateGraph(graph);

  if (validationErrors.length > 0) {
    return {
      ok: false,
      reason: formatGraphValidationErrors(validationErrors),
      requestId: context.requestId,
      moduleResults,
      finalOutputs: {},
      elapsedMs: Date.now() - startedAt,
    };
  }

  try {
    // 1. Topological sort
    const sorted = topologicalSort(graph.nodes, graph.edges);

    const [
      sourceImpls,
      filterImpls,
      transformImpls,
      composeImpls,
      executeImpls,
      outputImpls,
    ] = await Promise.all([
      import("./module-impls/source-impls"),
      import("./module-impls/filter-impls"),
      import("./module-impls/transform-impls"),
      import("./module-impls/compose-impls"),
      import("./module-impls/execute-impls"),
      import("./module-impls/output-impls"),
    ]);

    // 2. Execute each node in order
    for (const { node } of sorted) {
      if (context.abortSignal?.aborted || context.isCancelled?.()) {
        throw new Error("workflow cancelled by user");
      }

      const nodeStart = Date.now();
      const inputs = collectNodeInputs(node, graph.edges, nodeOutputs);

      context.onProgress?.({
        phase: "module_executing",
        request_id: context.requestId,
        module_id: node.moduleId,
        node_id: node.id,
        message: `正在执行模块「${getModuleBlueprint(node.moduleId).label}」…`,
      });

      try {
        const outputs = await executeModule(node, inputs, context, {
          sourceImpls,
          filterImpls,
          transformImpls,
          composeImpls,
          executeImpls,
          outputImpls,
        });
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
        throw new Error(
          `模块「${getModuleBlueprint(node.moduleId).label}」执行失败: ${errorMsg}`,
        );
      }
    }

    // 3. Collect final outputs (from all terminal nodes = no outgoing edges)
    const nodesWithOutgoing = new Set(graph.edges.map((e) => e.source));
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
  edgeId?: string;
  portId?: string;
  message: string;
}

function formatGraphValidationErrors(errors: GraphValidationError[]): string {
  return errors
    .map((error) => {
      const refs = [
        error.nodeId ? `node=${error.nodeId}` : null,
        error.edgeId ? `edge=${error.edgeId}` : null,
        error.portId ? `port=${error.portId}` : null,
      ].filter(Boolean);
      return refs.length > 0
        ? `[graph_validation ${refs.join(" ")}] ${error.message}`
        : `[graph_validation] ${error.message}`;
    })
    .join("; ");
}

interface GraphPortValidationContext {
  node: WorkbenchNode;
  port: ModulePortDef;
}

function formatNodeRef(node: WorkbenchNode, label?: string): string {
  return `节点「${label ?? node.moduleId}」(${node.id})`;
}

function formatPortRef(port: ModulePortDef): string {
  return `端口「${port.label}」(${port.id})`;
}

function isPortDataTypeCompatible(
  sourceType: PortDataType,
  targetType: PortDataType,
): boolean {
  if (sourceType === "any" || targetType === "any") return true;
  return sourceType === targetType;
}

function getPortContext(
  node: WorkbenchNode,
  portId: string,
): GraphPortValidationContext | null {
  try {
    const blueprint = getModuleBlueprint(node.moduleId);
    const port = blueprint.ports.find((candidate) => candidate.id === portId);
    if (!port) return null;
    return { node, port };
  } catch {
    return null;
  }
}

export function validateGraph(graph: WorkbenchGraph): GraphValidationError[] {
  const errors: GraphValidationError[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodeMap = new Map<string, WorkbenchNode>();
  const incomingEdgeCountByPort = new Map<string, number>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({
        nodeId: node.id,
        message: `检测到重复的节点 ID: ${node.id}`,
      });
      continue;
    }

    nodeIds.add(node.id);
    nodeMap.set(node.id, node);
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push({
        edgeId: edge.id,
        message: `检测到重复的连线 ID: ${edge.id}`,
      });
      continue;
    }

    edgeIds.add(edge.id);
  }

  // Check that all nodes reference valid module IDs
  for (const node of graph.nodes) {
    try {
      getModuleBlueprint(node.moduleId);
    } catch {
      errors.push({
        nodeId: node.id,
        message: `节点(${node.id})引用了未知的模块类型: ${node.moduleId}`,
      });
    }
  }

  // Check that all edge references and port contracts exist
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({
        edgeId: edge.id,
        message: `连线(${edge.id})引用了不存在的源节点: ${edge.source}`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({
        edgeId: edge.id,
        message: `连线(${edge.id})引用了不存在的目标节点: ${edge.target}`,
      });
    }

    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourcePortCtx = getPortContext(sourceNode, edge.sourcePort);
    if (!sourcePortCtx) {
      errors.push({
        edgeId: edge.id,
        nodeId: sourceNode.id,
        portId: edge.sourcePort,
        message: `${formatNodeRef(sourceNode)} 的源端口(${edge.sourcePort})不存在`,
      });
      continue;
    }

    const targetPortCtx = getPortContext(targetNode, edge.targetPort);
    if (!targetPortCtx) {
      errors.push({
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: edge.targetPort,
        message: `${formatNodeRef(targetNode)} 的目标端口(${edge.targetPort})不存在`,
      });
      continue;
    }

    if (sourcePortCtx.port.direction !== "out") {
      errors.push({
        edgeId: edge.id,
        nodeId: sourceNode.id,
        portId: sourcePortCtx.port.id,
        message: `${formatNodeRef(sourceNode)} 的 ${formatPortRef(sourcePortCtx.port)} 不是输出端口，不能作为连线源端口`,
      });
    }

    if (targetPortCtx.port.direction !== "in") {
      errors.push({
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: targetPortCtx.port.id,
        message: `${formatNodeRef(targetNode)} 的 ${formatPortRef(targetPortCtx.port)} 不是输入端口，不能作为连线目标端口`,
      });
    }

    if (
      sourcePortCtx.port.direction === "out" &&
      targetPortCtx.port.direction === "in" &&
      !isPortDataTypeCompatible(
        sourcePortCtx.port.dataType,
        targetPortCtx.port.dataType,
      )
    ) {
      errors.push({
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: targetPortCtx.port.id,
        message: `连线(${edge.id})类型不兼容：${formatNodeRef(sourceNode)} 的 ${formatPortRef(sourcePortCtx.port)} 输出类型为 ${sourcePortCtx.port.dataType}，但 ${formatNodeRef(targetNode)} 的 ${formatPortRef(targetPortCtx.port)} 需要 ${targetPortCtx.port.dataType}`,
      });
    }

    const incomingKey = `${targetNode.id}:${targetPortCtx.port.id}`;
    incomingEdgeCountByPort.set(
      incomingKey,
      (incomingEdgeCountByPort.get(incomingKey) ?? 0) + 1,
    );
  }

  for (const node of graph.nodes) {
    try {
      const bp = getModuleBlueprint(node.moduleId);
      const inputPorts = bp.ports.filter((p) => p.direction === "in");

      for (const port of inputPorts) {
        const connectionCount =
          incomingEdgeCountByPort.get(`${node.id}:${port.id}`) ?? 0;

        if (!port.optional && connectionCount === 0) {
          errors.push({
            nodeId: node.id,
            portId: port.id,
            message: `${formatNodeRef(node, bp.label)} 的必要输入 ${formatPortRef(port)} 未连接`,
          });
        }

        if (!port.multiple && connectionCount > 1) {
          errors.push({
            nodeId: node.id,
            portId: port.id,
            message: `${formatNodeRef(node, bp.label)} 的输入 ${formatPortRef(port)} 不允许多入边，但当前检测到 ${connectionCount} 条入边`,
          });
        }
      }
    } catch {
      // Already reported above
    }
  }

  // Check for cycles
  try {
    topologicalSort(graph.nodes, graph.edges);
  } catch (error) {
    errors.push({
      message: error instanceof Error ? error.message : "图中存在循环依赖",
    });
  }

  return errors;
}
