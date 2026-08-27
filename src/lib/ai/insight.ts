import 'server-only';

import type { PatternCandidate } from '@/lib/patterns/engine';
import type { OrganizationAiSettings } from '@/lib/types';

import { callStructured, isAiConfigured } from './client';
import { type PatternInsight, PatternInsightSchema } from './schemas';
import { buildSystemPrompt, evidenceBlock } from './prompts';

/**
 * Putting a detected pattern into words.
 *
 * The pattern itself — its existence, its numbers, its confidence — is decided
 * by the rule engine. This layer only rephrases. If it is unavailable, the
 * rule engine's own description is already coach-ready.
 */

const PATTERN_SHAPE = `{
  "title": string,
  "summary": string,
  "evidence": string[],
  "confidence": number,
  "suggestedCoachQuestion": string | null,
  "suggestedExperiment": string | null
}`;

export async function explainPattern(
  pattern: PatternCandidate,
  context: { organizationId: string; clientFirstName: string; aiSettings: Partial<OrganizationAiSettings> | null },
): Promise<PatternInsight> {
  const fallback: PatternInsight = {
    title: pattern.title,
    summary: pattern.description,
    evidence: pattern.evidence.statements,
    confidence: pattern.confidence,
    suggestedCoachQuestion: pattern.suggestedQuestion,
    suggestedExperiment: pattern.suggestedExperiment,
  };

  if (!isAiConfigured()) return fallback;

  try {
    const insight = await callStructured({
      feature: 'pattern_explanation',
      organizationId: context.organizationId,
      system: buildSystemPrompt(context.aiSettings),
      user: [
        `Explain this detected pattern to the coach in the organization's voice.`,
        'The confidence value and every figure are already decided, so echo them exactly.',
        'Do not introduce a cause. Do not add evidence that is not listed.',
        '',
        evidenceBlock('Pattern', {
          client: context.clientFirstName,
          type: pattern.patternType,
          title: pattern.title,
          description: pattern.description,
          confidence: pattern.confidence,
          evidence: pattern.evidence.statements,
          sampleSize: pattern.evidence.sampleSize,
        }),
      ].join('\n'),
      schema: PatternInsightSchema,
      shapeHint: PATTERN_SHAPE,
    });

    // The model does not get to move the confidence number.
    return { ...insight, confidence: pattern.confidence };
  } catch (error) {
    console.error('[ai] pattern explanation failed, using rule-engine wording', error);
    return fallback;
  }
}

