/* ═══ Graph Serializer — flows ↔ graph state ═══ */
import type { GraphNode, NodeType } from './graph-types';
import { NODE_TYPE_REGISTRY } from './graph-types';

/**
 * Convert a single EwFlowConfig into 7 graph nodes + 6 edges.
 * Returns { nodes, edges } for the chain.
 */
export function flowToNodes(
  flow: Record<string, any>,
  startX: number,
  startY: number,
): { nodes: GraphNode[]; edges: Array<{ source: string; sourcePort: string; target: string; targetPort: string }> } {
  const H = 300;
  const V = 30;
  let _id = 0;
  const uid = () => `f_${flow.id}_${(_id++).toString(36)}`;

  const gen = flow.generation_options || {};
  const beh = flow.behavior_options || {};

  const CHAIN: Array<{ type: NodeType; data: Record<string, any> }> = [
    {
      type: 'flow_entry',
      data: {
        _flowId: flow.id,
        name: flow.name || 'Flow',
        enabled: flow.enabled ?? true,
        timing: flow.timing || 'default',
        priority: flow.priority ?? 100,
        api_preset_id: flow.api_preset_id || '',
        timeout_ms: flow.timeout_ms ?? 300000,
      },
    },
    {
      type: 'generation_params',
      data: {
        temperature: gen.temperature ?? 1.2,
        top_p: gen.top_p ?? 0.92,
        frequency_penalty: gen.frequency_penalty ?? 0.85,
        presence_penalty: gen.presence_penalty ?? 0.5,
        max_reply_tokens: gen.max_reply_tokens ?? 65535,
        stream: gen.stream ?? true,
      },
    },
    {
      type: 'behavior_params',
      data: {
        name_behavior: beh.name_behavior || 'default',
        reasoning_effort: beh.reasoning_effort || 'auto',
        verbosity: beh.verbosity || 'auto',
        request_thinking: beh.request_thinking ?? false,
        continue_prefill: beh.continue_prefill ?? false,
        squash_system_messages: beh.squash_system_messages ?? false,
      },
    },
    {
      type: 'prompt_ordering',
      data: {
        prompt_order: flow.prompt_order || [],
      },
    },
    {
      type: 'context_rules',
      data: {
        extract_rules: flow.extract_rules || [],
        exclude_rules: flow.exclude_rules || [],
        custom_regex_rules: flow.custom_regex_rules || [],
      },
    },
    {
      type: 'request_builder',
      data: {
        request_template: flow.request_template || '',
        system_prompt: flow.system_prompt || '',
        headers_json: flow.headers_json || '',
      },
    },
    {
      type: 'response_processor',
      data: {
        response_extract_regex: flow.response_extract_regex || '',
        response_remove_regex: flow.response_remove_regex || '',
      },
    },
  ];

  const nodes: GraphNode[] = [];
  const edges: Array<{ source: string; sourcePort: string; target: string; targetPort: string }> = [];

  for (let i = 0; i < CHAIN.length; i++) {
    const { type, data } = CHAIN[i];
    const info = NODE_TYPE_REGISTRY[type];
    nodes.push({
      id: uid(),
      type,
      label: type === 'flow_entry' ? (flow.name || info.label) : info.label,
      position: { x: startX + i * H, y: startY + (i % 2 === 0 ? 0 : V) },
      collapsed: false,
      data,
      ports: info.defaultPorts.map(p => ({ ...p })),
    });
  }

  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      source: nodes[i].id,
      sourcePort: 'out',
      target: nodes[i + 1].id,
      targetPort: 'in',
    });
  }

  return { nodes, edges };
}

/**
 * Convert all flows into a full graph state (nodes + edges).
 * Each flow is arranged vertically, stacked below the previous one.
 */
export function flowsToGraph(
  flows: Array<Record<string, any>>,
): { nodes: GraphNode[]; edges: Array<{ id: string; source: string; sourcePort: string; target: string; targetPort: string }> } {
  const allNodes: GraphNode[] = [];
  const allEdges: Array<{ id: string; source: string; sourcePort: string; target: string; targetPort: string }> = [];
  const ROW_HEIGHT = 200;

  for (let fi = 0; fi < flows.length; fi++) {
    const { nodes, edges } = flowToNodes(flows[fi], 60, 60 + fi * ROW_HEIGHT);
    allNodes.push(...nodes);
    edges.forEach((e, i) => {
      allEdges.push({ id: `e_${flows[fi].id}_${i}`, ...e });
    });
  }

  return { nodes: allNodes, edges: allEdges };
}

/**
 * Convert graph nodes back into flow configs (reverse of flowToNodes).
 * Groups nodes by _flowId found in flow_entry nodes,
 * then merges data from each node type into the flow config.
 */
export function graphToFlows(
  nodes: GraphNode[],
  originalFlows: Array<Record<string, any>>,
): Array<Record<string, any>> {
  // Find all flow_entry nodes — each one represents one flow
  const entryNodes = nodes.filter(n => n.type === 'flow_entry' && n.data._flowId);

  return originalFlows.map(flow => {
    const entry = entryNodes.find(n => n.data._flowId === flow.id);
    if (!entry) return flow; // No matching entry node, return as-is

    // Find all nodes that belong to this flow by prefix
    const prefix = entry.id.replace(/_[^_]*$/, ''); // e.g. f_flowId
    const siblings = nodes.filter(n => n.id.startsWith(prefix + '_') || n.id === entry.id);

    const updated = { ...flow };

    for (const node of siblings) {
      switch (node.type) {
        case 'flow_entry':
          updated.name = node.data.name ?? flow.name;
          updated.enabled = node.data.enabled ?? flow.enabled;
          updated.timing = node.data.timing ?? flow.timing;
          updated.priority = node.data.priority ?? flow.priority;
          updated.api_preset_id = node.data.api_preset_id ?? flow.api_preset_id;
          updated.timeout_ms = node.data.timeout_ms ?? flow.timeout_ms;
          break;
        case 'generation_params':
          updated.generation_options = {
            ...(flow.generation_options || {}),
            temperature: node.data.temperature,
            top_p: node.data.top_p,
            frequency_penalty: node.data.frequency_penalty,
            presence_penalty: node.data.presence_penalty,
            max_reply_tokens: node.data.max_reply_tokens,
            stream: node.data.stream,
          };
          break;
        case 'behavior_params':
          updated.behavior_options = {
            ...(flow.behavior_options || {}),
            name_behavior: node.data.name_behavior,
            reasoning_effort: node.data.reasoning_effort,
            verbosity: node.data.verbosity,
            request_thinking: node.data.request_thinking,
            continue_prefill: node.data.continue_prefill,
            squash_system_messages: node.data.squash_system_messages,
          };
          break;
        case 'prompt_ordering':
          if (node.data.prompt_order) updated.prompt_order = node.data.prompt_order;
          break;
        case 'context_rules':
          if (node.data.extract_rules) updated.extract_rules = node.data.extract_rules;
          if (node.data.exclude_rules) updated.exclude_rules = node.data.exclude_rules;
          if (node.data.custom_regex_rules) updated.custom_regex_rules = node.data.custom_regex_rules;
          break;
        case 'request_builder':
          updated.request_template = node.data.request_template ?? flow.request_template;
          updated.system_prompt = node.data.system_prompt ?? flow.system_prompt;
          updated.headers_json = node.data.headers_json ?? flow.headers_json;
          break;
        case 'response_processor':
          updated.response_extract_regex = node.data.response_extract_regex ?? flow.response_extract_regex;
          updated.response_remove_regex = node.data.response_remove_regex ?? flow.response_remove_regex;
          break;
      }
    }

    return updated;
  });
}
