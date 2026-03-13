import { disposeGlobalApi, initGlobalApi } from './api';
import { disposeRuntimeEvents, initRuntimeEvents } from './events';
import { hydrateSharedSettings, loadLastIo, loadLastRun, loadSettings } from './settings';

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

    // 在 ST 扩展环境中，直接在 window 上暴露 API
    (window as any).EvolutionWorldAPI = (window as any).EvolutionWorldAPI ?? {};

    initialized = true;
    console.info('[Evolution World] runtime initialized');
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
  console.info('[Evolution World] runtime disposed');
}
