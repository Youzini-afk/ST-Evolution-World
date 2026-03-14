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
