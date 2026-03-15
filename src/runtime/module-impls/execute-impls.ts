/* ═══ Module Implementations — Execute Modules ═══ */
/*
 * Runtime implementations for Execute-category modules.
 * These handle API calls, response processing, and data extraction.
 */

import type { ModuleOutput } from '../../ui/components/graph/module-types';

// ── LLM Call ──

/**
 * Execute an LLM API call.
 * Supports two modes:
 *   - workflow_http: direct HTTP call to the configured API endpoint
 *   - llm_connector: route through SillyTavern's built-in API connection
 */
export async function executeLlmCall(
  messages: Array<{ role: string; content: string }>,
  apiConfig: Record<string, any>,
  genOptions?: Record<string, any>,
  behaviorOptions?: Record<string, any>,
): Promise<string> {
  const mode = apiConfig.mode ?? 'workflow_http';

  if (mode === 'llm_connector' || apiConfig.use_main_api) {
    return executeLlmViaConnector(messages, genOptions, behaviorOptions);
  }

  return executeLlmViaHttp(messages, apiConfig, genOptions);
}

async function executeLlmViaConnector(
  messages: Array<{ role: string; content: string }>,
  genOptions?: Record<string, any>,
  _behaviorOptions?: Record<string, any>,
): Promise<string> {
  try {
    const endpoint = '/api/backends/chat-completions/generate';
    const body: any = {
      messages,
      model: genOptions?.model ?? '',
      temperature: genOptions?.temperature ?? 1.0,
      max_tokens: genOptions?.max_reply_tokens ?? 4096,
      top_p: genOptions?.top_p ?? 1.0,
      frequency_penalty: genOptions?.frequency_penalty ?? 0,
      presence_penalty: genOptions?.presence_penalty ?? 0,
      stream: false,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`LLM API returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    console.error('[ExecuteImpl:llm_call] Connector error:', e);
    throw e;
  }
}

async function executeLlmViaHttp(
  messages: Array<{ role: string; content: string }>,
  apiConfig: Record<string, any>,
  genOptions?: Record<string, any>,
): Promise<string> {
  const apiUrl = apiConfig.api_url;
  if (!apiUrl) throw new Error('API URL 未配置');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiConfig.api_key) {
    headers['Authorization'] = `Bearer ${apiConfig.api_key}`;
  }

  // Parse custom headers
  if (apiConfig.headers_json) {
    try {
      const custom = JSON.parse(apiConfig.headers_json);
      Object.assign(headers, custom);
    } catch { /* ignore */ }
  }

  const body: any = {
    model: apiConfig.model ?? genOptions?.model ?? '',
    messages,
    temperature: genOptions?.temperature ?? 1.0,
    max_tokens: genOptions?.max_reply_tokens ?? 4096,
    top_p: genOptions?.top_p ?? 1.0,
    frequency_penalty: genOptions?.frequency_penalty ?? 0,
    presence_penalty: genOptions?.presence_penalty ?? 0,
    stream: false,
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? data?.content ?? '';
}

// ── Response Extract ──

/**
 * Extract content from text using a regex pattern (first capture group).
 */
export function executeResponseExtract(
  text: string,
  pattern: string,
): string {
  if (!pattern || !text) return text;

  try {
    const rx = new RegExp(pattern, 's');
    const match = rx.exec(text);
    if (match) {
      return match[1] ?? match[0];
    }
  } catch (e) {
    console.debug('[ExecuteImpl:response_extract] Regex error:', e);
  }

  return text;
}

// ── Response Remove ──

/**
 * Remove content matching a regex from text.
 */
export function executeResponseRemove(
  text: string,
  pattern: string,
): string {
  if (!pattern || !text) return text;

  try {
    const rx = new RegExp(pattern, 'gs');
    return text.replace(rx, '').trim();
  } catch (e) {
    console.debug('[ExecuteImpl:response_remove] Regex error:', e);
  }

  return text;
}

// ── Response Normalize ──

/**
 * Auto-fill standard fields in an AI response JSON object:
 * version, flow_id, status, timestamp.
 */
export function executeResponseNormalize(
  raw: Record<string, any>,
): Record<string, any> {
  return {
    version: 1,
    flow_id: raw.flow_id ?? '',
    status: raw.status ?? 'ok',
    timestamp: raw.timestamp ?? Date.now(),
    ...raw,
  };
}

// ── SSE Stream Read ──

/**
 * Read SSE (Server-Sent Events) stream and accumulate full text.
 * Stub implementation — actual streaming is handled at the API layer.
 */
export async function executeStreamSse(
  response: any,
): Promise<string> {
  // In practice, SSE streaming is handled by the LLM connector or
  // the fetch response reader. This node provides a composability
  // point in the graph.
  if (typeof response === 'string') return response;
  if (response?.text) return response.text;
  if (response?.content) return response.content;
  return '';
}
