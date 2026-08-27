import { z } from 'zod';

/**
 * Structured AI output contracts.
 *
 * Nothing a model returns is stored until it has passed one of these schemas.
 * Note what is absent: no schema has a field for a number the model computed.
 * Rates, counts and gaps are always passed *in* to the model and echoed back
 * as prose — the model is a writer, not a calculator.
 */

export const PatternInsightSchema = z.object({
  title: z.string().min(4).max(120),
  summary: z.string().min(20).max(700),
  evidence: z.array(z.string().min(3).max(200)).min(1).max(5),
  confidence: z.number().min(0).max(1),
  suggestedCoachQuestion: z.string().min(8).max(240).nullable(),
  suggestedExperiment: z.string().min(8).max(300).nullable(),
});
export type PatternInsight = z.infer<typeof PatternInsightSchema>;

export const CoachingBriefSchema = z.object({
  headline: z.string().min(8).max(160),
  summary: z.string().min(60).max(1600),
  keyObservations: z.array(z.string().min(8).max(280)).min(1).max(5),
  suggestedQuestions: z.array(z.string().min(8).max(240)).min(1).max(4),
  suggestedExperiment: z.string().min(8).max(320).nullable(),
});
export type CoachingBriefContent = z.infer<typeof CoachingBriefSchema>;


