/* ═══ DAG Node Graph Editor — Type Definitions ═══ */

export type NodeType =
  | 'flow_entry'
  | 'generation_params'
  | 'behavior_params'
  | 'prompt_ordering'
  | 'context_rules'
  | 'request_builder'
  | 'response_processor'
  | 'worldbook_output';

export interface PortDefinition {
  id: string;
  label: string;
  direction: 'in' | 'out';
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  position: { x: number; y: number };
  collapsed: boolean;
  data: Record<string, any>;
  ports: PortDefinition[];
}

export interface GraphEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport: GraphViewport;
}

/** Registry entry for each node type */
export interface NodeTypeInfo {
  type: NodeType;
  label: string;
  color: string;        // accent color (CSS)
  icon: string;          // emoji or icon char
  defaultPorts: PortDefinition[];
}

/** Port position in canvas coordinates (computed at runtime) */
export interface PortPosition {
  nodeId: string;
  portId: string;
  x: number;
  y: number;
}

// ── Node Type Registry ──

export const NODE_TYPE_REGISTRY: Record<NodeType, NodeTypeInfo> = {
  flow_entry: {
    type: 'flow_entry',
    label: '工作流入口',
    color: '#f59e0b',
    icon: '⚡',
    defaultPorts: [
      { id: 'out', label: '输出', direction: 'out' },
    ],
  },
  generation_params: {
    type: 'generation_params',
    label: '生成参数',
    color: '#6366f1',
    icon: '⚙',
    defaultPorts: [
      { id: 'in', label: '输入', direction: 'in' },
      { id: 'out', label: '输出', direction: 'out' },
    ],
  },
  behavior_params: {
    type: 'behavior_params',
    label: '行为参数',
    color: '#8b5cf6',
    icon: '🎭',
    defaultPorts: [
      { id: 'in', label: '输入', direction: 'in' },
      { id: 'out', label: '输出', direction: 'out' },
    ],
  },
  prompt_ordering: {
    type: 'prompt_ordering',
    label: '提示词编排',
    color: '#10b981',
    icon: '📝',
    defaultPorts: [
      { id: 'in', label: '配置', direction: 'in' },
      { id: 'out', label: '消息', direction: 'out' },
    ],
  },
  context_rules: {
    type: 'context_rules',
    label: '上下文规则',
    color: '#3b82f6',
    icon: '🔍',
    defaultPorts: [
      { id: 'in', label: '消息', direction: 'in' },
      { id: 'out', label: '处理后', direction: 'out' },
    ],
  },
  request_builder: {
    type: 'request_builder',
    label: '请求构建',
    color: '#ec4899',
    icon: '📡',
    defaultPorts: [
      { id: 'in', label: '输入', direction: 'in' },
      { id: 'out', label: '请求', direction: 'out' },
    ],
  },
  response_processor: {
    type: 'response_processor',
    label: '响应处理',
    color: '#ef4444',
    icon: '🎯',
    defaultPorts: [
      { id: 'in', label: '响应', direction: 'in' },
    ],
  },
  worldbook_output: {
    type: 'worldbook_output',
    label: '世界书输出',
    color: '#14b8a6',
    icon: '📚',
    defaultPorts: [
      { id: 'in', label: '数据', direction: 'in' },
    ],
  },
};
