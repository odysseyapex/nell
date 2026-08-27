import type { Metadata } from 'next';

import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, EvidenceList } from '@/components/shared/metric-display';
import { requireClient } from '@/lib/auth/session';
import { getClientFacts } from '@/lib/data/client-view';
import { computeClientMetrics, formatRate, todayIn } from '@/lib/metrics';
import { addDays } from '@/lib/metrics/dates';
import { detectPatterns } from '@/lib/patterns/engine';

export const metadata: Metadata = { title: 'Insights' };
export const dynamic = 'force-dynamic';

/**
 * The client's view of their own patterns.
 *
 * Deliberately not a dashboard. A client does not need a risk score, a trend
 * arrow or a comparison against other people — they need one or two things
 * they might not have noticed, the evidence behind them, and a question to sit
 * with. Everything here is phrased as an observation about conditions, never
 * as a judgement about the person.
 */
export default async function InsightsPage() {
  const { profile, organization } = await requireClient();
  const timezone = profile.timezone ?? organization.timezone;
  const referenceDate = todayIn(timezone);

  const facts = await getClientFacts(profile.id, addDays(referenceDate, -180));
  const metrics = computeClientMetrics({ facts, referenceDate });
  const patterns = detectPatterns(facts, { referenceDate });

  const strengths = patterns.filter((pattern) => pattern.patternType === 'strength');
  const observations = patterns.filter((pattern) => pattern.patternType !== 'strength');

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">What Nell has noticed</h1>
        <p className="mt-1 text-muted-foreground">
          Observations from what you have recorded. They are associations, not explanations — you
          are the one who knows what they mean.
        </p>
      </header>

      {metrics.followThrough30.eligible > 0 ? (
        <Card>
          <CardContent className="p-5">
            <p className="metric-label">Last 30 days</p>
            <p className="mt-2 metric-value">{formatRate(metrics.followThrough30.rate)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {metrics.followThrough30.completed} of {metrics.followThrough30.eligible} commitments
              went the way you planned.
              {metrics.followThrough30.changed > 0
                ? ` ${metrics.followThrough30.changed} changed along the way.`
                : ''}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {patterns.length === 0 ? (
        <EmptyState
          title="Nothing to report yet"
          description="Nell waits until there is enough recorded to say something worth reading — usually around two weeks of check-ins. Until then it would only be guessing."
        />
      ) : (
        <section className="space-y-4">
          {observations.map((pattern) => (
            <Card key={pattern.patternKey}>
              <CardContent className="space-y-4 p-5 sm:p-6">
                <div>
                  <p className="metric-label">Nell noticed</p>
                  <p className="mt-2 text-lg font-medium">{pattern.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {pattern.description}
                  </p>
                </div>

                <EvidenceList statements={pattern.evidence.statements} title="What this is based on" />

                {pattern.suggestedQuestion ? (
                  <div className="rounded-lg border border-[var(--brand)] bg-[var(--brand-soft)] px-4 py-3">
                    <p className="metric-label">Worth sitting with</p>
                    <p className="mt-1 font-medium">{pattern.suggestedQuestion}</p>
                  </div>
                ) : null}

                {pattern.suggestedExperiment ? (
                  <div>
                    <p className="metric-label">Something you could test</p>
                    <p className="mt-1 text-sm">{pattern.suggestedExperiment}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Your coach can set this up as an experiment and measure whether it changes
                      anything.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}

          {strengths.map((pattern) => (
            <Card key={pattern.patternKey} className="border-[hsl(var(--signal-stable))]">
              <CardContent className="space-y-3 p-5 sm:p-6">
                <p className="metric-label">Working well</p>
                <p className="text-lg font-medium">{pattern.title}</p>
                <p className="text-sm text-muted-foreground">{pattern.description}</p>
                <EvidenceList statements={pattern.evidence.statements} title="What this is based on" />
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {metrics.calibration.sampleSize >= 5 && metrics.calibration.gap !== null ? (
        <Card>
          <CardContent className="space-y-3 p-5 sm:p-6">
            <p className="metric-label">Your predictions</p>
            <p className="text-sm leading-relaxed">
              When you make a commitment you rate how realistic it is. On average you have predicted{' '}
              <strong className="tabular">{formatRate(metrics.calibration.predicted)}</strong>, and{' '}
              <strong className="tabular">{formatRate(metrics.calibration.actual)}</strong> of those
              commitments happened.
            </p>
            <p className="text-sm text-muted-foreground">
              {metrics.calibration.gap >= 0.15
                ? 'That gap usually says something about the size of the plan rather than about you.'
                : metrics.calibration.gap <= -0.15
                  ? 'You are doing more than you expect to. There may be room to aim higher.'
                  : 'Your sense of what is realistic is tracking closely with what happens.'}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
