import 'server-only';

import { type ClientMetrics, formatRate } from '@/lib/metrics';
import type { PatternCandidate } from '@/lib/patterns/engine';
import type { OrganizationAiSettings } from '@/lib/types';

import { AiUnavailableError, callStructured, isAiConfigured } from './client';
import { type CoachingBriefContent, CoachingBriefSchema } from './schemas';
import { buildSystemPrompt, evidenceBlock } from './prompts';

export interface BriefInput {
  clientFirstName: string;
  metrics: ClientMetrics;
  patterns: PatternCandidate[];
  periodStart: string;
  periodEnd: string;
  organizationId: string;
  aiSettings: Partial<OrganizationAiSettings> | null;
  activeExperiment?: { title: string; hypothesis: string; status: string } | null;
}

export interface BriefResult {
  content: CoachingBriefContent;
  /** 'model' when written by the LLM, 'deterministic' when composed from the data alone. */
  source: 'model' | 'deterministic';
  model: string | null;
}

/**
 * Composes a brief from the numbers alone.
 *
 * This is not a placeholder. It is the guaranteed floor of the product: if
 * OpenAI is unconfigured, rate-limited or down, the coach still gets an
 * accurate brief, because every sentence here is assembled from values that
 * were already computed. The AI path improves the prose; it does not supply
 * the substance.
 */
export function composeBriefDeterministic(input: BriefInput): CoachingBriefContent {
  const { metrics, patterns, clientFirstName: name } = input;

  const current = formatRate(metrics.followThrough30.rate);
  const previous = formatRate(metrics.followThroughPrev30.rate);

  const headline =
    metrics.trend === 'declining'
      ? `${name}'s follow-through fell from ${previous} to ${current}`
      : metrics.trend === 'improving'
        ? `${name}'s follow-through rose from ${previous} to ${current}`
        : metrics.followThrough30.rate === null
          ? `Not enough recorded activity yet to read ${name}'s follow-through`
          : `${name}'s follow-through is holding at ${current}`;

  const observations: string[] = [];

  if (metrics.followThrough30.eligible > 0) {
    observations.push(
      `Over the last 30 days ${metrics.followThrough30.completed} of ${metrics.followThrough30.eligible} ` +
        `commitments were completed (${current}); ${metrics.followThrough30.changed} were changed and ` +
        `${metrics.followThrough30.missed} were missed.`,
    );
  }

  const topReason = metrics.topReasons[0];
  if (topReason && topReason.count >= 2) {
    observations.push(
      `The most frequently recorded factor behind commitments that did not go to plan was ` +
        `${topReason.name.toLowerCase()}, appearing ${topReason.count} times (${formatRate(topReason.share)} of them).`,
    );
  }

  if (metrics.calibration.gap !== null && Math.abs(metrics.calibration.gap) >= 0.1) {
    observations.push(
      `Predicted confidence averaged ${formatRate(metrics.calibration.predicted)} against actual ` +
        `follow-through of ${formatRate(metrics.calibration.actual)} across ${metrics.calibration.sampleSize} commitments.`,
    );
  }

  if (metrics.overdueCheckins > 0) {
    observations.push(
      `${metrics.overdueCheckins} commitment(s) are past their date without a check-in, so recent figures rest on less data than usual.`,
    );
  }

  for (const pattern of patterns.slice(0, 2)) {
    observations.push(`${pattern.title}. ${pattern.evidence.statements.join('; ')}.`);
  }

  if (observations.length === 0) {
    observations.push(
      `${name} has not yet recorded enough commitments for Nellvia to read a pattern. ` +
        'Two weeks of check-ins is usually the point where trends become readable.',
    );
  }

  const questions = patterns
    .map((p) => p.suggestedQuestion)
    .filter((q): q is string => Boolean(q))
    .slice(0, 3);

  if (questions.length === 0) {
    questions.push(
      metrics.trend === 'declining'
        ? 'What has changed in the last few weeks that the current plan has not caught up with?'
        : 'Which commitment has felt easiest to keep lately, and what makes it easy?',
    );
  }

  const summary = [
    `${headline}.`,
    ...observations,
    'These are associations in recorded data, not explanations. They are a starting point for the conversation.',
  ].join(' ');

  return {
    headline,
    summary,
    keyObservations: observations.slice(0, 5),
    suggestedQuestions: questions.slice(0, 4),
    suggestedExperiment: patterns.find((p) => p.suggestedExperiment)?.suggestedExperiment ?? null,
  };
}

const BRIEF_SHAPE = `{
  "headline": string,
  "summary": string,
  "keyObservations": string[],
  "suggestedQuestions": string[],
  "suggestedExperiment": string | null
}`;

export async function generateBrief(input: BriefInput): Promise<BriefResult> {
  const deterministic = composeBriefDeterministic(input);

  if (!isAiConfigured()) {
    return { content: deterministic, source: 'deterministic', model: null };
  }

  // Only pre-computed values cross this boundary. The model receives no raw
  // journal text and no ability to introduce a number of its own.
  const payload = {
    client: input.clientFirstName,
    period: { start: input.periodStart, end: input.periodEnd },
    followThrough: {
      last7Days: input.metrics.followThrough7,
      last30Days: input.metrics.followThrough30,
      previous30Days: input.metrics.followThroughPrev30,
      trend: input.metrics.trend,
      changeInRatePoints:
        input.metrics.trendDelta === null ? null : Math.round(input.metrics.trendDelta * 100),
    },
    confidenceCalibration: input.metrics.calibration,
    topReasons: input.metrics.topReasons.slice(0, 4),
    outstandingCheckIns: input.metrics.overdueCheckins,
    exerciseCompletion30Days: input.metrics.exerciseCompletion30,
    detectedPatterns: input.patterns.map((p) => ({
      title: p.title,
      description: p.description,
      confidence: p.confidence,
      evidence: p.evidence.statements,
      sampleSize: p.evidence.sampleSize,
    })),
    activeExperiment: input.activeExperiment ?? null,
    deterministicDraft: deterministic,
  };

  try {
    const content = await callStructured({
      feature: 'coaching_brief',
      organizationId: input.organizationId,
      system: buildSystemPrompt(input.aiSettings),
      user: [
        'Write a pre-call brief for the coach about this client.',
        'A correct but plain draft is included as "deterministicDraft" — improve its clarity and',
        'tone, but do not add any fact, number or claim that is not already present in the data.',
        'Aim for something the coach can absorb in under 30 seconds.',
        '',
        evidenceBlock('Evidence', payload),
      ].join('\n'),
      schema: CoachingBriefSchema,
      shapeHint: BRIEF_SHAPE,
    });

    return { content, source: 'model', model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini' };
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) {
      console.error('[ai] brief generation failed, falling back to deterministic draft', error);
    }
    return { content: deterministic, source: 'deterministic', model: null };
  }
}
