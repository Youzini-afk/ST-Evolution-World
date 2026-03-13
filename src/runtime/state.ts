import { now, simpleHash } from './helpers';
import { EwSettings } from './types';

type SendRecord = {
  message_id: number;
  user_input: string;
  hash: string;
  at: number;
};

type SendIntentRecord = {
  user_input: string;
  hash: string;
  at: number;
};

type GenerationRecord = {
  type: string;
  params: {
    automatic_trigger?: boolean;
    quiet_prompt?: string;
    [key: string]: any;
  };
  dry_run: boolean;
  at: number;
};

type AfterReplyRecord = {
  pending_user_message_id: number | null;
  pending_user_input: string;
  pending_generation_type: string;
  pending_at: number;
  last_handled_assistant_message_id: number | null;
  last_handled_hash: string;
  last_handled_at: number;
};

export type RuntimeState = {
  last_send: SendRecord | null;
  last_send_intent: SendIntentRecord | null;
  last_generation: GenerationRecord | null;
  after_reply: AfterReplyRecord;
  is_processing: boolean;
};

const state: RuntimeState = {
  last_send: null,
  last_send_intent: null,
  last_generation: null,
  after_reply: {
    pending_user_message_id: null,
    pending_user_input: '',
    pending_generation_type: '',
    pending_at: 0,
    last_handled_assistant_message_id: null,
    last_handled_hash: '',
    last_handled_at: 0,
  },
  is_processing: false,
};

export function getRuntimeState(): RuntimeState {
  return state;
}

export function recordUserSend(message_id: number, user_input: string) {
  state.last_send = {
    message_id,
    user_input,
    hash: simpleHash(user_input),
    at: now(),
  };
  state.after_reply.pending_user_message_id = message_id;
  state.after_reply.pending_user_input = user_input;
  state.after_reply.pending_at = now();
}

export function recordUserSendIntent(user_input: string) {
  state.last_send_intent = {
    user_input,
    hash: simpleHash(user_input),
    at: now(),
  };
}

export function recordGeneration(type: string, params: Record<string, any> | undefined, dry_run: boolean) {
  state.last_generation = {
    type,
    params: (params ?? {}) as GenerationRecord['params'],
    dry_run,
    at: now(),
  };

  state.after_reply.pending_generation_type = type;
  if (!state.after_reply.pending_at) {
    state.after_reply.pending_at = now();
  }
}

export function setProcessing(processing: boolean) {
  state.is_processing = processing;
}

export function clearSendContext() {
  state.last_send = null;
  state.last_send_intent = null;
}

export function clearAfterReplyPending() {
  state.after_reply.pending_user_message_id = null;
  state.after_reply.pending_user_input = '';
  state.after_reply.pending_generation_type = '';
  state.after_reply.pending_at = 0;
}

export function markAfterReplyHandled(message_id: number, content: string) {
  state.after_reply.last_handled_assistant_message_id = message_id;
  state.after_reply.last_handled_hash = simpleHash(content);
  state.after_reply.last_handled_at = now();
}

export function wasAfterReplyHandled(message_id: number, content: string): boolean {
  if (state.after_reply.last_handled_assistant_message_id === message_id) {
    return true;
  }

  const contentHash = simpleHash(content);
  if (!contentHash || !state.after_reply.last_handled_hash) {
    return false;
  }

  return state.after_reply.last_handled_hash === contentHash && now() - state.after_reply.last_handled_at <= 30000;
}

export function resetRuntimeState() {
  state.last_send = null;
  state.last_send_intent = null;
  state.last_generation = null;
  clearAfterReplyPending();
  state.after_reply.last_handled_assistant_message_id = null;
  state.after_reply.last_handled_hash = '';
  state.after_reply.last_handled_at = 0;
  state.is_processing = false;
}

export function isQuietLike(type: string, params: { quiet_prompt?: string } | undefined): boolean {
  if (type === 'quiet') {
    return true;
  }
  if (params?.quiet_prompt && String(params.quiet_prompt).trim()) {
    return true;
  }
  return false;
}

export function shouldHandleGenerationAfter(
  type: string,
  params: { automatic_trigger?: boolean; quiet_prompt?: string } | undefined,
  dry_run: boolean,
  settings: EwSettings,
): { ok: boolean; reason: string } {
  if (!settings.enabled) {
    return { ok: false, reason: 'disabled' };
  }
  if (state.is_processing) {
    return { ok: false, reason: 'already_processing' };
  }
  if (dry_run) {
    return { ok: false, reason: 'dry_run' };
  }
  if (isQuietLike(type, params)) {
    return { ok: false, reason: 'quiet' };
  }
  if (params?.automatic_trigger) {
    return { ok: false, reason: 'automatic_trigger' };
  }
  // 允许用户可配置 trigger_types 的标准生成类型。
  const allowedTypes = new Set(['normal', 'continue', 'regenerate', 'swipe']);
  if (!allowedTypes.has(type)) {
    return { ok: false, reason: `unsupported_type:${type}` };
  }

  // CR-2: continue/regenerate/swipe 不会创建新的发送记录，因此
  // gate_ttl 新鲜度检查几乎总会拒绝它们。跳过该检查。
  const noSendTypes = new Set(['continue', 'regenerate', 'swipe']);
  if (noSendTypes.has(type)) {
    return { ok: true, reason: 'ok' };
  }

  const lastSend = state.last_send;
  const lastIntent = state.last_send_intent;
  const hasFreshSend = Boolean(lastSend && now() - lastSend.at <= settings.gate_ttl_ms);
  const hasFreshIntent = Boolean(lastIntent && now() - lastIntent.at <= settings.gate_ttl_ms);

  if (!hasFreshSend && !hasFreshIntent) {
    return { ok: false, reason: 'missing_send_context' };
  }

  return { ok: true, reason: 'ok' };
}

export function shouldHandleAfterReply(
  message_id: number,
  type: string,
  settings: EwSettings,
): { ok: boolean; reason: string } {
  if (!settings.enabled) {
    return { ok: false, reason: 'disabled' };
  }
  if (state.is_processing) {
    return { ok: false, reason: 'already_processing' };
  }
  if (type === 'quiet' || type === 'impersonate' || type === 'command' || type === 'extension') {
    return { ok: false, reason: `unsupported_type:${type}` };
  }
  if (state.last_generation?.dry_run) {
    return { ok: false, reason: 'dry_run' };
  }
  if (state.last_generation?.params?.automatic_trigger) {
    return { ok: false, reason: 'automatic_trigger' };
  }
  if (state.after_reply.last_handled_assistant_message_id === message_id) {
    return { ok: false, reason: 'already_handled' };
  }

  const windowMs = Math.max(settings.total_timeout_ms + 10000, settings.gate_ttl_ms, 600000);
  const hasFreshPending = Boolean(state.after_reply.pending_at && now() - state.after_reply.pending_at <= windowMs);
  const hasFreshGeneration = Boolean(state.last_generation && now() - state.last_generation.at <= windowMs);

  if (!hasFreshPending && !hasFreshGeneration) {
    return { ok: false, reason: 'missing_generation_context' };
  }

  return { ok: true, reason: 'ok' };
}
