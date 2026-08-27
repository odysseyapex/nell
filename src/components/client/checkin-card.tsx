'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import { track } from '@/components/shared/analytics-provider';
import { CHECKIN_OUTCOMES, type CheckinOutcome, type Commitment, type ReasonCode } from '@/lib/types';
import { type ActionState, checkInCommitment } from '@/app/app/actions';

/**
 * The check-in.
 *
 * This is the highest-value thirty seconds in the product, so the design goal
 * is that it never feels like admin. Five outcomes, one tap; the reason step
 * only appears when there is something to explain, and the free-text box is
 * always optional.
 *
 * The outcome wording is first-person and non-judgemental on purpose. "I
 * didn't do it" is a fact. "Failed" is a verdict, and a client who feels
 * judged stops checking in — at which point Nell goes blind.
 */
export function CheckinCard({
  commitment,
  reasonCodes,
}: {
  commitment: Commitment;
  reasonCodes: ReasonCode[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(checkInCommitment, {});
  const [outcome, setOutcome] = useState<CheckinOutcome | null>(null);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [done, setDone] = useState(false);

  const needsReason = outcome !== null && outcome !== 'completed';

  useEffect(() => {
    if (state.message) {
      toast.success(state.message);
      track(ANALYTICS_EVENTS.commitmentCheckedIn, { outcome: outcome ?? undefined });
      setDone(true);
    }
    if (state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message, state.error]);

  if (done) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">Recorded — {commitment.commitment_text}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <p className="metric-label">
          On {commitment.commitment_date} you committed to
          {commitment.confidence_score !== null ? ` (${commitment.confidence_score}% confident)` : ''}
        </p>
        <p className="mt-2 text-lg font-medium">{commitment.commitment_text}</p>

        <form action={formAction} className="mt-6 space-y-5">
          <input type="hidden" name="commitmentId" value={commitment.id} />
          <input type="hidden" name="outcome" value={outcome ?? ''} />
          <input type="hidden" name="reasonCodeId" value={reasonCodeId} />

          <fieldset className="space-y-2">
            <legend className="mb-3 text-base font-medium">What happened?</legend>
            {CHECKIN_OUTCOMES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setOutcome(option.value)}
                aria-pressed={outcome === option.value}
                className={cn(
                  'flex w-full flex-col items-start rounded-lg border px-4 py-3 text-left transition-colors',
                  outcome === option.value
                    ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                    : 'border-border hover:bg-muted/60',
                )}
              >
                <span className="font-medium">{option.label}</span>
                <span className="text-sm text-muted-foreground">{option.helper}</span>
              </button>
            ))}
          </fieldset>

          {needsReason ? (
            <div className="space-y-4 animate-fade-in">
              <div>
                <Label className="text-base">What influenced that?</Label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {reasonCodes.map((reason) => (
                    <button
                      key={reason.id}
                      type="button"
                      onClick={() => setReasonCodeId(reason.id === reasonCodeId ? '' : reason.id)}
                      aria-pressed={reasonCodeId === reason.id}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm transition-colors',
                        reasonCodeId === reason.id
                          ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                          : 'border-border hover:bg-muted/60',
                      )}
                    >
                      {reason.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`note-${commitment.id}`}>
                  Anything else you want to remember? <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea id={`note-${commitment.id}`} name="reasonText" className="min-h-[72px]" />
              </div>
            </div>
          ) : null}

          <SubmitButton disabled={outcome === null} />
        </form>
      </CardContent>
    </Card>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="xl" className="w-full" disabled={pending || disabled}>
      {pending ? 'Saving…' : 'Record it'}
    </Button>
  );
}
