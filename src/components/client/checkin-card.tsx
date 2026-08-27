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
 * appears only when there is something to explain; the note is always
 * optional and never a blank page demanding a paragraph.
 *
 * The outcome wording is first-person and describes the event, not the person.
 * "I didn't do it" is a fact someone can record honestly on a bad day.
 * Anything that reads as a grade teaches people to stop recording — at which
 * point the coach goes blind, which is the one outcome the product cannot
 * survive.
 */
export function CheckinCard({
  commitment,
  reasonCodes,
  collapsible = false,
}: {
  commitment: Commitment;
  reasonCodes: ReasonCode[];
  /** On Today, the card opens as a single "Check in" call to action. */
  collapsible?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(checkInCommitment, {});
  const [open, setOpen] = useState(!collapsible);
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
          <p className="text-sm text-muted-foreground">Recorded: {commitment.commitment_text}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <p className="metric-label">
          {commitment.commitment_date} · you committed to
        </p>
        <p className="mt-2 text-lg font-medium">{commitment.commitment_text}</p>

        {commitment.confidence_score !== null ? (
          <p className="mt-2 text-sm text-muted-foreground">
            How realistic it felt: <span className="tabular">{commitment.confidence_score}%</span>
          </p>
        ) : null}

        {commitment.anticipated_obstacle ? (
          <p className="mt-1 text-sm text-muted-foreground">
            You expected: {commitment.anticipated_obstacle}
          </p>
        ) : null}

        {!open ? (
          <Button size="xl" className="mt-5 w-full" onClick={() => setOpen(true)}>
            Check in
          </Button>
        ) : (
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
              <div className="animate-fade-in space-y-4">
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
                          'rounded-full border px-3.5 py-2 text-sm transition-colors',
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
                    Anything you want to remember?{' '}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id={`note-${commitment.id}`}
                    name="reasonText"
                    className="min-h-[64px]"
                    placeholder="One line is plenty."
                  />
                </div>
              </div>
            ) : null}

            <SubmitButton disabled={outcome === null} />
          </form>
        )}
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
