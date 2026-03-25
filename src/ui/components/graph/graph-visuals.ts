import {
  MODULE_CATEGORIES,
  type ModuleCategory,
  type PortDataType,
} from "./module-types";

export interface PortTypeVisual {
  label: string;
  shortLabel: string;
  color: string;
}

const PORT_TYPE_VISUALS: Record<PortDataType, PortTypeVisual> = {
  any: { label: "任意", shortLabel: "ANY", color: "#94a3b8" },
  text: { label: "文本", shortLabel: "TXT", color: "#22c55e" },
  messages: { label: "消息", shortLabel: "MSG", color: "#06b6d4" },
  entries: { label: "词条", shortLabel: "ENTRY", color: "#f59e0b" },
  json: { label: "JSON", shortLabel: "JSON", color: "#a855f7" },
  api_config: { label: "API 配置", shortLabel: "API", color: "#818cf8" },
  gen_options: { label: "生成参数", shortLabel: "GEN", color: "#6366f1" },
  behavior_options: { label: "行为参数", shortLabel: "BEH", color: "#8b5cf6" },
  flow_context: { label: "流程上下文", shortLabel: "CTX", color: "#38bdf8" },
  results: { label: "结果", shortLabel: "RES", color: "#14b8a6" },
  operations: { label: "操作", shortLabel: "OPS", color: "#f97316" },
  snapshot: { label: "快照", shortLabel: "SNAP", color: "#eab308" },
  http_response: { label: "HTTP 响应", shortLabel: "HTTP", color: "#ef4444" },
  timing: { label: "触发时机", shortLabel: "TIME", color: "#facc15" },
  activation: { label: "激活", shortLabel: "ACT", color: "#fb923c" },
  boolean: { label: "布尔", shortLabel: "BOOL", color: "#facc15" },
  number: { label: "数值", shortLabel: "NUM", color: "#38bdf8" },
};

export function getPortTypeVisual(dataType: PortDataType): PortTypeVisual {
  return PORT_TYPE_VISUALS[dataType] ?? PORT_TYPE_VISUALS.any;
}

export function getModuleCategoryVisual(category: ModuleCategory) {
  return (
    MODULE_CATEGORIES.find((item) => item.id === category) ?? {
      id: category,
      label: category,
      icon: "•",
      color: "#6366f1",
      order: 999,
    }
  );
}
