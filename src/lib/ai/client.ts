import 'server-only';

import OpenAI from 'openai';
import type { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * The only place in the codebase that talks to OpenAI.
 *
 * Server-only by construction — the key is read through serverEnv(), which
 * throws if it is ever reached from the browser.
 */

let cached: OpenAI | null = null;

export function isAiConfigured(): boolean {
  return Boolean(serverEnv().OPENAI_API_KEY);
}

function getClient(): OpenAI {
  const { OPENAI_API_KEY } = serverEnv();
  if (!OPENAI_API_KEY) throw new AiUnavailableError('OPENAI_API_KEY is not configured');
  cached ??= new OpenAI({ apiKey: OPENAI_API_KEY });
  return cached;
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export interface StructuredCallOptions<T extends z.ZodTypeAny> {
  feature: string;
  organizationId: string | null;
  system: string;
  user: string;
  schema: T;
  /** Shape hint appended to the prompt so the model knows the field names. */
  shapeHint: string;
  temperature?: number;
  maxRetries?: number;
}

/**
 * Calls the model and refuses to return anything that does not satisfy the
 * schema.
 *
 * A validation failure is retried once with the validation error fed back,
 * because a malformed field is usually recoverable. If it fails twice the
 * error propagates — callers fall back to deterministic text rather than
 * showing a coach something unvalidated.
 */
export async function callStructured<T extends z.ZodTypeAny>(
  options: StructuredCallOptions<T>,
): Promise<z.infer<T>> {
  const client = getClient();
  const { OPENAI_MODEL } = serverEnv();
  const maxRetries = options.maxRetries ?? 1;
  const startedAt = Date.now();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: options.system },
    {
      role: 'user',
      content: `${options.user}\n\nReturn JSON with exactly this shape:\n${options.shapeHint}`,
    },
  ];

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const completion = await client.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: options.temperature ?? 0.3,
        response_format: { type: 'json_object' },
        messages,
      });

      const raw = completion.choices[0]?.message?.content ?? '';
      const parsed = options.schema.parse(JSON.parse(raw));

      void recordUsage({
        organizationId: options.organizationId,
        feature: options.feature,
        model: OPENAI_MODEL,
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
        succeeded: true,
      });

      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        messages.push({
          role: 'user',
          content:
            `That response could not be used: ${
              error instanceof Error ? error.message : 'invalid JSON'
            }. Return only valid JSON matching the requested shape.`,
        });
      }
    }
  }

  void recordUsage({
    organizationId: options.organizationId,
    feature: options.feature,
    model: OPENAI_MODEL,
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: Date.now() - startedAt,
    succeeded: false,
    errorCode: lastError instanceof Error ? lastError.name : 'unknown',
  });

  throw lastError instanceof Error ? lastError : new Error('AI call failed');
}

interface UsageRecord {
  organizationId: string | null;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  succeeded: boolean;
  errorCode?: string;
}

/**
 * Records token counts and outcome only. Prompt and completion content are
 * deliberately never written here — this table exists for cost and reliability
 * visibility, not as a second copy of client reflections.
 */
async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from('ai_usage_events').insert({
      organization_id: record.organizationId,
      feature: record.feature,
      model: record.model,
      prompt_tokens: record.promptTokens,
      completion_tokens: record.completionTokens,
      latency_ms: record.latencyMs,
      succeeded: record.succeeded,
      error_code: record.errorCode ?? null,
    });
  } catch {
    // Usage accounting must never break a user-facing feature.
  }
}
