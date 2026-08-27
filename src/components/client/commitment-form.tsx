'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { ANALYTICS_EVENTS, confidenceBucket } from '@/lib/analytics';
import { track } from '@/components/shared/analytics-provider';
import { type ActionState, createCommitment } from '@/app/app/actions';

/**
 * Making a commitment.
 *
 * The confidence slider is the part that matters and the part people skip, so
 * it is given real estate rather than tucked away: without a prediction made
 * *before* the behaviour, there is nothing to calibrate against afterwards.
 *
 * The wording under the slider deliberately avoids "how motivated are you" —
 * the question is about the plan's realism, not the person's willpower.
 */
export function CommitmentForm({ today, tomorrow }: { today: string; tomorrow: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createCommitment, {});
  const [confidence, setConfidence] = useState(70);
  const [text, setText] = useState('');
  const [date, setDate] = useState(tomorrow);
  const [obstacle, setObstacle] = useState('');

  useEffect(() => {
    if (state.message) {
      toast.success(state.message);
      track(ANALYTICS_EVENTS.commitmentCreated, {
        confidence_bucket: confidenceBucket(confidence),
      });
      setText('');
      setConfidence(70);
      setObstacle('');
    }
    if (state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message, state.error]);

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <form action={formAction} className="space-y-6">
          <input type="hidden" name="confidence" value={confidence} />

          <div className="space-y-2">
            <Label htmlFor="commitmentText" className="text-base">
              What are you committing to?
            </Label>
            <Textarea
              id="commitmentText"
              name="commitmentText"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Walk for 30 minutes after work"
              className="min-h-[80px] text-base"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="commitmentDate" className="text-base">
              When will this happen?
            </Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={date === today ? 'default' : 'outline'}
                onClick={() => setDate(today)}
              >
                Today
              </Button>
              <Button
                type="button"
                variant={date === tomorrow ? 'default' : 'outline'}
                onClick={() => setDate(tomorrow)}
              >
                Tomorrow
              </Button>
              <Input
                id="commitmentDate"
                name="commitmentDate"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="w-auto"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="anticipatedObstacle" className="text-base">
              What might make this harder?{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="anticipatedObstacle"
              name="anticipatedObstacle"
              placeholder="A late meeting, being tired, eating out"
              value={obstacle}
              onChange={(event) => setObstacle(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Naming it now makes it easier to spot later.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label className="text-base">How realistic is this?</Label>
              <span className="text-2xl font-semibold tabular">{confidence}%</span>
            </div>
            <Slider
              value={[confidence]}
              onValueChange={([value]) => setConfidence(value)}
              min={0}
              max={100}
              step={5}
              aria-label="Confidence that this will happen"
            />
            <p className="text-sm text-muted-foreground">
              Not how much you want it — how likely it is to actually happen, given the week you
              have ahead.
            </p>
          </div>

          <SubmitButton disabled={text.trim().length < 3} />
        </form>
      </CardContent>
    </Card>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="xl" className="w-full" disabled={pending || disabled}>
      {pending ? 'Saving…' : 'Commit'}
    </Button>
  );
}
