/* ═══ EwFlowConfig → WorkbenchGraph Migrator ═══ */
/*
 * Converts legacy EwFlowConfig objects into WorkbenchGraph objects
 * that can be executed by the new graph-based engine.
 *
 * Migration strategy:
 *  - Each EwFlowConfig field maps to one or more module nodes
 *  - Edges are created to wire data flow between nodes
 *  - Layout uses a simple top-down grid
 */

import type {
  WorkbenchEdge,
  WorkbenchGraph,
  WorkbenchNode,
} from "../ui/components/graph/module-types";
import type { EwFlowConfig } from "./types";

let globalMigSeq = 0;

function makeId(): string {
  return `mig_${(globalMigSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeNode(
  moduleId: string,
  config: Record<string, any>,
  x: number,
  y: number,
): WorkbenchNode {
  return {
    id: makeId(),
    moduleId,
    position: { x, y },
    config,
    collapsed: false,
  };
}

function makeEdge(
  sourceNode: string,
  sourcePort: string,
  targetNode: string,
  targetPort: string,
): WorkbenchEdge {
  return {
    id: `edge_${sourceNode}_${sourcePort}_${targetNode}_${targetPort}`,
    source: sourceNode,
    sourcePort,
    target: targetNode,
    targetPort,
  };
}

/**
 * Convert a single EwFlowConfig into a WorkbenchGraph.
 */
export function migrateFlowToGraph(flow: EwFlowConfig): WorkbenchGraph {
  const nodes: WorkbenchNode[] = [];
  const edges: WorkbenchEdge[] = [];

  // ── Column layout constants ──
  const COL_SRC = 0;
  const COL_FILTER = 300;
  const COL_TRANSFORM = 600;
  const COL_COMPOSE = 900;
  const COL_EXECUTE = 1200;
  const COL_OUTPUT = 1500;
  const ROW_H = 120;
  let srcRow = 0;
  let filterRow = 0;
  let transformRow = 0;

  // ═══ Source Layer ═══

  // 1. Character fields
  const charFieldsNode = makeNode(
    "src_char_fields",
    {},
    COL_SRC,
    srcRow++ * ROW_H,
  );
  nodes.push(charFieldsNode);

  // 2. Chat history
  const chatHistoryNode = makeNode(
    "src_chat_history",
    {
      context_turns: flow.context_turns ?? 8,
    },
    COL_SRC,
    srcRow++ * ROW_H,
  );
  nodes.push(chatHistoryNode);

  // 3. User input
  const userInputNode = makeNode(
    "src_user_input",
    {},
    COL_SRC,
    srcRow++ * ROW_H,
  );
  nodes.push(userInputNode);

  // 4. Flow context
  const flowCtxNode = makeNode(
    "src_flow_context",
    {},
    COL_SRC,
    srcRow++ * ROW_H,
  );
  nodes.push(flowCtxNode);

  // 5. World book (if needed by extract or exclude rules)
  let worldbookNode: WorkbenchNode | null = null;
  if (flow.extract_rules.length > 0 || flow.exclude_rules.length > 0) {
    worldbookNode = makeNode(
      "src_worldbook_raw",
      {
        include_character: true,
        include_persona: true,
        include_chat: true,
        include_global: true,
      },
      COL_SRC,
      srcRow++ * ROW_H,
    );
    nodes.push(worldbookNode);
  }

  // ═══ Filter Layer ═══

  // Context extract rules → flt_context_extract
  let filteredMsgsNode: WorkbenchNode | null = null;
  if (flow.extract_rules.length > 0) {
    const extractNode = makeNode(
      "flt_context_extract",
      {
        rules: flow.extract_rules
          .filter((r) => r.start && r.end)
          .map((r) => ({
            pattern: `${escapeRegex(r.start)}[\\s\\S]*?${escapeRegex(r.end)}`,
            flags: "i",
          })),
      },
      COL_FILTER,
      filterRow++ * ROW_H,
    );
    nodes.push(extractNode);
    edges.push(
      makeEdge(chatHistoryNode.id, "messages", extractNode.id, "msgs_in"),
    );
    filteredMsgsNode = extractNode;
  }

  // Context exclude rules → flt_context_exclude
  if (flow.exclude_rules.length > 0) {
    const excludeNode = makeNode(
      "flt_context_exclude",
      {
        rules: flow.exclude_rules
          .filter((r) => r.start && r.end)
          .map((r) => ({
            pattern: `${escapeRegex(r.start)}[\\s\\S]*?${escapeRegex(r.end)}`,
            flags: "i",
          })),
      },
      COL_FILTER,
      filterRow++ * ROW_H,
    );
    nodes.push(excludeNode);

    const sourceForExclude = filteredMsgsNode ?? chatHistoryNode;
    const sourcePort = filteredMsgsNode ? "msgs_out" : "messages";
    edges.push(
      makeEdge(sourceForExclude.id, sourcePort, excludeNode.id, "msgs_in"),
    );
    filteredMsgsNode = excludeNode;
  }

  // Custom regex rules → flt_custom_regex
  let customRegexNode: WorkbenchNode | null = null;
  if (flow.custom_regex_rules.length > 0) {
    const enabledRules = flow.custom_regex_rules.filter((r) => r.enabled);
    if (enabledRules.length > 0) {
      customRegexNode = makeNode(
        "flt_custom_regex",
        {
          rules: enabledRules.map((r) => ({
            find: r.find_regex,
            replace: r.replace_string,
            flags: "g",
          })),
        },
        COL_FILTER,
        filterRow++ * ROW_H,
      );
      nodes.push(customRegexNode);
    }
  }

  // Hide messages
  const hideNode = makeNode(
    "flt_hide_messages",
    {
      hide_last_n: 0,
      limiter_enabled: false,
      limiter_count: 20,
    },
    COL_FILTER,
    filterRow++ * ROW_H,
  );
  nodes.push(hideNode);

  const msgsSourceForHide = filteredMsgsNode ?? chatHistoryNode;
  const msgsPortForHide = filteredMsgsNode ? "msgs_out" : "messages";
  edges.push(
    makeEdge(msgsSourceForHide.id, msgsPortForHide, hideNode.id, "msgs_in"),
  );

  // ═══ Transform Layer ═══

  // Macro replace on system prompt
  let systemPromptNode: WorkbenchNode | null = null;
  if (flow.system_prompt) {
    const cfgSysPrompt = makeNode(
      "cfg_system_prompt",
      {
        content: flow.system_prompt,
      },
      COL_TRANSFORM,
      transformRow++ * ROW_H,
    );
    nodes.push(cfgSysPrompt);

    const macroNode = makeNode(
      "tfm_macro_replace",
      {},
      COL_TRANSFORM,
      transformRow++ * ROW_H,
    );
    nodes.push(macroNode);
    edges.push(makeEdge(cfgSysPrompt.id, "prompt", macroNode.id, "text_in"));
    systemPromptNode = macroNode;

    // If custom regex exists, chain it
    if (customRegexNode) {
      edges.push(
        makeEdge(macroNode.id, "text_out", customRegexNode.id, "text_in"),
      );
    }
  }

  // ═══ Config Layer ═══

  // API preset config
  const apiCfgNode = makeNode(
    "cfg_api_preset",
    {
      api_preset_id: flow.api_preset_id || "",
      api_url: flow.api_url || "",
      api_key: flow.api_key || "",
      headers_json: flow.headers_json || "",
    },
    COL_COMPOSE,
    0,
  );
  nodes.push(apiCfgNode);

  // Generation options
  const genCfgNode = makeNode(
    "cfg_generation",
    {
      ...flow.generation_options,
    },
    COL_COMPOSE,
    ROW_H,
  );
  nodes.push(genCfgNode);

  // Behavior options
  const behaviorCfgNode = makeNode(
    "cfg_behavior",
    {
      ...flow.behavior_options,
    },
    COL_COMPOSE,
    ROW_H * 2,
  );
  nodes.push(behaviorCfgNode);

  // Timing config
  const timingNode = makeNode(
    "cfg_timing",
    {
      timing: flow.timing ?? "default",
    },
    COL_COMPOSE,
    ROW_H * 3,
  );
  nodes.push(timingNode);

  // ═══ Compose Layer ═══

  // Prompt order
  const promptOrderNode = makeNode(
    "cmp_prompt_order",
    {
      prompt_order: flow.prompt_order.map((po) => ({
        identifier: po.identifier,
        enabled: po.enabled,
      })),
    },
    COL_COMPOSE,
    ROW_H * 4,
  );
  nodes.push(promptOrderNode);

  // Wire char fields → prompt order components
  edges.push(
    makeEdge(charFieldsNode.id, "main", promptOrderNode.id, "components"),
  );

  // Wire filtered messages → depth inject
  const depthInjectNode = makeNode(
    "cmp_depth_inject",
    {},
    COL_COMPOSE,
    ROW_H * 5,
  );
  nodes.push(depthInjectNode);
  edges.push(
    makeEdge(promptOrderNode.id, "msgs_out", depthInjectNode.id, "messages"),
  );
  edges.push(
    makeEdge(hideNode.id, "msgs_out", depthInjectNode.id, "injections"),
  );

  // ═══ Execute Layer ═══

  // LLM Call
  const llmCallNode = makeNode(
    "exe_llm_call",
    {
      use_main_api: !flow.api_url,
    },
    COL_EXECUTE,
    0,
  );
  nodes.push(llmCallNode);
  edges.push(
    makeEdge(depthInjectNode.id, "msgs_out", llmCallNode.id, "messages"),
  );
  edges.push(makeEdge(apiCfgNode.id, "config", llmCallNode.id, "api_config"));
  edges.push(makeEdge(genCfgNode.id, "options", llmCallNode.id, "gen_options"));
  edges.push(
    makeEdge(behaviorCfgNode.id, "options", llmCallNode.id, "behavior"),
  );

  // Response extract (if configured)
  let responseChain: WorkbenchNode = llmCallNode;
  let responsePort = "raw_response";

  if (flow.response_extract_regex) {
    const extractNode = makeNode(
      "exe_response_extract",
      {
        pattern: flow.response_extract_regex,
      },
      COL_EXECUTE,
      ROW_H,
    );
    nodes.push(extractNode);
    edges.push(makeEdge(responseChain.id, responsePort, extractNode.id, "raw"));
    responseChain = extractNode;
    responsePort = "extracted";
  }

  // Response remove (if configured)
  if (flow.response_remove_regex) {
    const removeNode = makeNode(
      "exe_response_remove",
      {
        pattern: flow.response_remove_regex,
      },
      COL_EXECUTE,
      ROW_H * 2,
    );
    nodes.push(removeNode);
    edges.push(makeEdge(responseChain.id, responsePort, removeNode.id, "raw"));
    responseChain = removeNode;
    responsePort = "cleaned";
  }

  // JSON parse
  const jsonParseNode = makeNode("exe_json_parse", {}, COL_EXECUTE, ROW_H * 3);
  nodes.push(jsonParseNode);
  edges.push(
    makeEdge(responseChain.id, responsePort, jsonParseNode.id, "text"),
  );

  // ═══ Output Layer ═══

  // Floor bind
  const floorBindNode = makeNode("out_floor_bind", {}, COL_OUTPUT, 0);
  nodes.push(floorBindNode);
  edges.push(makeEdge(jsonParseNode.id, "parsed", floorBindNode.id, "result"));

  // World book write
  const wbWriteNode = makeNode("out_worldbook_write", {}, COL_OUTPUT, ROW_H);
  nodes.push(wbWriteNode);
  edges.push(
    makeEdge(jsonParseNode.id, "parsed", wbWriteNode.id, "operations"),
  );

  return {
    id: `migrated_${flow.id}`,
    name: `[迁移] ${flow.name}`,
    enabled: flow.enabled,
    timing: flow.timing,
    priority: flow.priority,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.6 },
  };
}

/**
 * Migrate all flows from settings into workbench_graphs.
 * Returns the new array of WorkbenchGraphs; does NOT mutate the original.
 */
export function migrateAllFlows(flows: EwFlowConfig[]): WorkbenchGraph[] {
  return flows.map((flow) => migrateFlowToGraph(flow));
}

/**
 * Auto-migrate: if settings.workbench_graphs is empty but flows exist,
 * migrate them and return the graphs. Otherwise return existing graphs.
 */
export function autoMigrateIfNeeded(settings: {
  flows?: EwFlowConfig[];
  workbench_graphs?: WorkbenchGraph[];
}): WorkbenchGraph[] {
  const existing = settings.workbench_graphs ?? [];
  if (existing.length > 0) return existing;

  const flows = settings.flows ?? [];
  if (flows.length === 0) return [];

  console.info(
    `[EW Migration] Auto-migrating ${flows.length} legacy flows to workbench graphs…`,
  );
  return migrateAllFlows(flows);
}
