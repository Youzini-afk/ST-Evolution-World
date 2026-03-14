/* ═══ DAG Node Graph Editor — Reactive State ═══ */
import { reactive, computed } from 'vue';
import type { GraphState, GraphNode, GraphEdge, GraphViewport, NodeType, PortPosition } from './graph-types';
import { NODE_TYPE_REGISTRY } from './graph-types';

let _nextId = 1;
function uid(): string {
  return `n_${Date.now().toString(36)}_${(_nextId++).toString(36)}`;
}

/** Create the reactive graph state store */
export function createGraphState() {
  const state = reactive<GraphState>({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  // ── Port position cache (updated by node components) ──
  const portPositions = reactive<Map<string, PortPosition>>(new Map());

  function portKey(nodeId: string, portId: string): string {
    return `${nodeId}::${portId}`;
  }

  function setPortPosition(nodeId: string, portId: string, x: number, y: number) {
    portPositions.set(portKey(nodeId, portId), { nodeId, portId, x, y });
  }

  function getPortPosition(nodeId: string, portId: string): PortPosition | undefined {
    return portPositions.get(portKey(nodeId, portId));
  }

  // ── Node CRUD ──

  function addNode(type: NodeType, x: number, y: number, data: Record<string, any> = {}): GraphNode {
    const info = NODE_TYPE_REGISTRY[type];
    const node: GraphNode = {
      id: uid(),
      type,
      label: info.label,
      position: { x, y },
      collapsed: false,
      data,
      ports: info.defaultPorts.map(p => ({ ...p })),
    };
    state.nodes.push(node);
    return node;
  }

  function removeNode(nodeId: string) {
    // Remove connected edges first
    state.edges = state.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    state.nodes = state.nodes.filter(n => n.id !== nodeId);
    // Clean port positions
    for (const key of portPositions.keys()) {
      if (key.startsWith(nodeId + '::')) {
        portPositions.delete(key);
      }
    }
  }

  function moveNode(nodeId: string, x: number, y: number) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
      node.position.x = x;
      node.position.y = y;
    }
  }

  function toggleCollapse(nodeId: string) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
      node.collapsed = !node.collapsed;
    }
  }

  // ── Edge CRUD ──

  function addEdge(source: string, sourcePort: string, target: string, targetPort: string): GraphEdge | null {
    // Prevent duplicate edges
    const exists = state.edges.some(
      e => e.source === source && e.sourcePort === sourcePort &&
           e.target === target && e.targetPort === targetPort
    );
    if (exists) return null;

    // Prevent self-loops
    if (source === target) return null;

    // DAG cycle check
    if (wouldCreateCycle(source, target)) return null;

    const edge: GraphEdge = {
      id: uid(),
      source,
      sourcePort,
      target,
      targetPort,
    };
    state.edges.push(edge);
    return edge;
  }

  function removeEdge(edgeId: string) {
    state.edges = state.edges.filter(e => e.id !== edgeId);
  }

  /** Check if adding source→target would create a cycle */
  function wouldCreateCycle(source: string, target: string): boolean {
    // BFS from target to see if we can reach source
    const visited = new Set<string>();
    const queue = [target];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === source) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of state.edges) {
        if (edge.source === current && !visited.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }
    return false;
  }

  // ── Viewport ──

  function panTo(x: number, y: number) {
    state.viewport.x = x;
    state.viewport.y = y;
  }

  function zoomTo(zoom: number, centerX?: number, centerY?: number) {
    const prevZoom = state.viewport.zoom;
    const newZoom = Math.max(0.15, Math.min(2.5, zoom));
    if (centerX !== undefined && centerY !== undefined) {
      // Zoom towards pointer
      const scale = newZoom / prevZoom;
      state.viewport.x = centerX - (centerX - state.viewport.x) * scale;
      state.viewport.y = centerY - (centerY - state.viewport.y) * scale;
    }
    state.viewport.zoom = newZoom;
  }

  function fitToView(containerWidth: number, containerHeight: number) {
    if (state.nodes.length === 0) {
      state.viewport = { x: 0, y: 0, zoom: 1 };
      return;
    }

    const PADDING = 60;
    const NODE_W = 260;
    const NODE_H = 120;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of state.nodes) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + NODE_W);
      maxY = Math.max(maxY, node.position.y + NODE_H);
    }

    const graphW = maxX - minX + PADDING * 2;
    const graphH = maxY - minY + PADDING * 2;
    const zoom = Math.min(1.5, containerWidth / graphW, containerHeight / graphH);

    state.viewport.zoom = zoom;
    state.viewport.x = (containerWidth - graphW * zoom) / 2 - (minX - PADDING) * zoom;
    state.viewport.y = (containerHeight - graphH * zoom) / 2 - (minY - PADDING) * zoom;
  }

  // ── Computed ──

  const nodeMap = computed(() => {
    const map = new Map<string, GraphNode>();
    for (const n of state.nodes) map.set(n.id, n);
    return map;
  });

  return {
    state,
    portPositions,
    setPortPosition,
    getPortPosition,
    addNode,
    removeNode,
    moveNode,
    toggleCollapse,
    addEdge,
    removeEdge,
    wouldCreateCycle,
    panTo,
    zoomTo,
    fitToView,
    nodeMap,
  };
}

export type GraphStore = ReturnType<typeof createGraphState>;
