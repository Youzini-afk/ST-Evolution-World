import {
  getCompositeModuleKind,
  getCompositeModules,
  getCompositeRetrySafety,
  getCompositeTemplateContract,
  getModuleBlueprint,
} from "./module-registry";
import type {
  CompositeModuleKind,
  ModuleBlueprint,
  WorkbenchBuilderMode,
} from "./module-types";

export type StudioComponentDirectoryEntryKind = "group" | "module";

export interface StudioComponentDirectoryEntry {
  id: string;
  kind: StudioComponentDirectoryEntryKind;
  label: string;
  description: string;
  moduleId?: string;
  compositeKind?: CompositeModuleKind | "atomic";
  featured?: boolean;
  recommendedBuilderMode?: WorkbenchBuilderMode;
  children: StudioComponentDirectoryEntry[];
}

export interface StudioComponentPreview {
  moduleId: string;
  label: string;
  description: string;
  compositeKind: CompositeModuleKind | "atomic";
  featured: boolean;
  recommendedBuilderMode?: WorkbenchBuilderMode;
  learningLabels: string[];
  entryContractLabels: string[];
  exitContractLabels: string[];
  retryReasonLabel: string | null;
  retryBlockingLabels: string[];
  childLabels: string[];
}

function getDisplayNodeLabel(node: {
  moduleId: string;
  config?: Record<string, any>;
}): string {
  if (typeof node.config?._label === "string" && node.config._label.trim()) {
    return node.config._label.trim();
  }
  try {
    return getModuleBlueprint(node.moduleId).label;
  } catch {
    return node.moduleId;
  }
}

function buildModuleTreeEntry(params: {
  moduleId: string;
  idPrefix: string;
  overrideLabel?: string;
  visited: Set<string>;
}): StudioComponentDirectoryEntry {
  const blueprint = getModuleBlueprint(params.moduleId);
  const isComposite = blueprint.isComposite === true;
  const compositeKind = isComposite
    ? getCompositeModuleKind(blueprint)
    : "atomic";
  const nextVisited = new Set(params.visited);
  nextVisited.add(params.moduleId);

  const children =
    isComposite && blueprint.compositeTemplate
      ? blueprint.compositeTemplate.nodes.map((node, index) => {
          if (nextVisited.has(node.moduleId)) {
            return {
              id: `${params.idPrefix}:${index}:${node.moduleId}`,
              kind: "module" as const,
              label: getDisplayNodeLabel(node),
              description:
                getModuleBlueprint(node.moduleId).description ??
                node.moduleId,
              moduleId: node.moduleId,
              compositeKind:
                getModuleBlueprint(node.moduleId).isComposite === true
                  ? getCompositeModuleKind(getModuleBlueprint(node.moduleId))
                  : "atomic",
              featured: getModuleBlueprint(node.moduleId).featured === true,
              recommendedBuilderMode:
                getModuleBlueprint(node.moduleId).recommendedBuilderMode,
              children: [],
            };
          }
          return buildModuleTreeEntry({
            moduleId: node.moduleId,
            idPrefix: `${params.idPrefix}:${index}:${node.moduleId}`,
            overrideLabel: getDisplayNodeLabel(node),
            visited: nextVisited,
          });
        })
      : [];

  return {
    id: params.idPrefix,
    kind: "module",
    label: params.overrideLabel ?? blueprint.label,
    description: blueprint.description,
    moduleId: params.moduleId,
    compositeKind,
    featured: blueprint.featured === true,
    recommendedBuilderMode: blueprint.recommendedBuilderMode,
    children,
  };
}

function buildTopLevelGroup(params: {
  id: string;
  label: string;
  description: string;
  modules: ModuleBlueprint[];
}): StudioComponentDirectoryEntry {
  return {
    id: params.id,
    kind: "group",
    label: params.label,
    description: params.description,
    children: params.modules.map((module) =>
      buildModuleTreeEntry({
        moduleId: module.moduleId,
        idPrefix: `${params.id}:${module.moduleId}`,
        visited: new Set(),
      }),
    ),
  };
}

export function getStudioComponentDirectory(): StudioComponentDirectoryEntry[] {
  const packages = getCompositeModules("package").filter(
    (module) => (module.compositeTemplate?.nodes.length ?? 0) > 0,
  );
  const fragments = getCompositeModules("fragment").filter(
    (module) => (module.compositeTemplate?.nodes.length ?? 0) > 0,
  );

  const retryFallback = fragments.filter(
    (module) => module.kitFamily === "retry_fallback",
  );
  const controlFlow = fragments.filter(
    (module) => module.kitFamily === "control_flow",
  );
  const generic = fragments.filter(
    (module) =>
      module.kitFamily !== "retry_fallback" &&
      module.kitFamily !== "control_flow",
  );

  return [
    buildTopLevelGroup({
      id: "packages",
      label: "工作流包",
      description: "较大颗粒的工作流构件，适合作为起步骨架。",
      modules: packages,
    }),
    buildTopLevelGroup({
      id: "retry_fallback",
      label: "重试与回退",
      description: "围绕 retry-safe 边界、回退和恢复的构件。",
      modules: retryFallback,
    }),
    buildTopLevelGroup({
      id: "control_flow",
      label: "控制流构件",
      description: "围绕条件、并行、合流和分支的构件。",
      modules: controlFlow,
    }),
    buildTopLevelGroup({
      id: "generic",
      label: "通用构件",
      description: "其余可拆解、可复用的构件。",
      modules: generic,
    }),
  ].filter((group) => group.children.length > 0);
}

export function findStudioComponentDirectoryEntry(
  entryId: string | null | undefined,
  entries: StudioComponentDirectoryEntry[] = getStudioComponentDirectory(),
): StudioComponentDirectoryEntry | null {
  if (!entryId) {
    return null;
  }
  for (const entry of entries) {
    if (entry.id === entryId) {
      return entry;
    }
    const nested = findStudioComponentDirectoryEntry(entryId, entry.children);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function formatContractTarget(target: {
  nodeLabel: string;
  portLabel: string;
  kind: "data" | "activation";
}): string {
  return `${target.nodeLabel}.${target.portLabel}${target.kind === "activation" ? " (activation)" : ""}`;
}

export function getStudioComponentPreview(
  moduleId: string | null | undefined,
): StudioComponentPreview | null {
  if (!moduleId) {
    return null;
  }
  const blueprint = getModuleBlueprint(moduleId);
  const compositeKind =
    blueprint.isComposite === true ? getCompositeModuleKind(blueprint) : "atomic";
  const contract = blueprint.isComposite
    ? getCompositeTemplateContract(moduleId)
    : null;
  const retrySafety = blueprint.isComposite
    ? getCompositeRetrySafety(moduleId)
    : null;

  const learningLabels: string[] = [];
  if (blueprint.featured === true) {
    learningLabels.push("精选");
  }
  if (blueprint.recommendedBuilderMode) {
    learningLabels.push(`建议 ${blueprint.recommendedBuilderMode}`);
  }
  if (blueprint.kitFamily) {
    learningLabels.push(blueprint.kitFamily);
  }

  return {
    moduleId,
    label: blueprint.label,
    description: blueprint.description,
    compositeKind,
    featured: blueprint.featured === true,
    recommendedBuilderMode: blueprint.recommendedBuilderMode,
    learningLabels,
    entryContractLabels:
      contract?.entries.map((entry) => {
        const targets = entry.targets.map(formatContractTarget).join("、");
        return `${entry.label} · ${targets}`;
      }) ?? [],
    exitContractLabels:
      contract?.exits.map(
        (entry) => `${entry.label} · ${formatContractTarget(entry.source)}`,
      ) ?? [],
    retryReasonLabel: retrySafety?.requested ? retrySafety.reasonLabel : null,
    retryBlockingLabels:
      retrySafety?.blockingNodeLabels.map((label) => `阻塞节点 · ${label}`) ?? [],
    childLabels:
      blueprint.compositeTemplate?.nodes.map((node) => getDisplayNodeLabel(node)) ??
      [],
  };
}

export function getFirstStudioComponentModuleId(
  entries: StudioComponentDirectoryEntry[] = getStudioComponentDirectory(),
): string | null {
  for (const entry of entries) {
    if (entry.kind === "module" && entry.moduleId) {
      return entry.moduleId;
    }
    const nested = getFirstStudioComponentModuleId(entry.children);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function getFirstStudioComponentEntryId(
  entries: StudioComponentDirectoryEntry[] = getStudioComponentDirectory(),
): string | null {
  for (const entry of entries) {
    if (entry.kind === "module" && entry.moduleId) {
      return entry.id;
    }
    const nested = getFirstStudioComponentEntryId(entry.children);
    if (nested) {
      return nested;
    }
  }
  return null;
}
