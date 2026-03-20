import { disposeGlobalApi, initGlobalApi } from "./api";
import { disposeRuntimeEvents, initRuntimeEvents } from "./events";
import { scheduleHideSettingsApply } from "./hide-engine";
import {
  getSettings,
  hydrateSharedSettings,
  loadLastIo,
  loadLastRun,
  loadSettings,
} from "./settings";

let initialized = false;
let initPromise: Promise<void> | null = null;

export async function initRuntime() {
  if (initialized) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    loadSettings();
    loadLastRun();
    loadLastIo();
    await hydrateSharedSettings();
    initGlobalApi();
    initRuntimeEvents();
    scheduleHideSettingsApply(getSettings().hide_settings, 220);

    // 与脚本版保持一致：EvolutionWorldAPI 只由 initGlobalApi() 负责挂载，
    // 避免初始化阶段出现空对象覆盖或 API 暴露边界不一致。

    initialized = true;
    console.info("[Evolution World] runtime initialized");
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

export function disposeRuntime() {
  if (!initialized) {
    return;
  }

  disposeRuntimeEvents();
  disposeGlobalApi();

  initialized = false;
  console.info("[Evolution World] runtime disposed");
}
