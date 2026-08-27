'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { CommitmentForm } from '@/components/client/commitment-form';
import { cn } from '@/lib/utils';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import { track } from '@/components/shared/analytics-provider';
import { type ActionState, abandonExercise, submitExercise } from '@/app/app/actions';
import type { ExerciseResponse, FrameworkStep } from '@/lib/types';

/**
 * Renders a coach's framework as a form.
 *
 * Nothing about any particular methodology is hard-coded: the steps, their
 * order, their input types and their help text are all data. A coach who works
 * in "Pause / Notice / Choose" and one who works in "Trigger / Thought /
 * Action" get the same runner.
 */

interface Answer {
  text: string;
  number: number | null;
  choices: string[];
}

function initialAnswer(step: FrameworkStep, existing?: ExerciseResponse): Answer {
  const config = step.configuration_json ?? {};
  const fallbackNumber =
    step.input_type === 'slider' || step.input_type === 'scale'
      ? Math.round(((config.min ?? 0) + (config.max ?? 10)) / 2)
      : null;

  const storedChoices =
    existing?.response_json && typeof existing.response_json === 'object'
      ? ((existing.response_json as { choices?: string[] }).choices ?? [])
      : [];

  return {
    text: existing?.response_text ?? '',
    number: existing?.response_number ?? fallbackNumber,
    choices: storedChoices,
  };
}

export function ExerciseRunner({
  entryId,
  exerciseName,
  exerciseDescription,
  promptsCommitment,
  completed,
  steps,
  existingResponses,
  today,
  tomorrow,
}: {
  entryId: string;
  exerciseName: string;
  exerciseDescription: string | null;
  promptsCommitment: boolean;
  completed: boolean;
  steps: FrameworkStep[];
  existingResponses: ExerciseResponse[];
  today: string;
  tomorrow: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionState, FormData>(submitExercise, {});
  const [saved, setSaved] = useState(completed);

  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(
      steps.map((step) => [
        step.id,
        initialAnswer(
          step,
          existingResponses.find((response) => response.framework_step_id === step.id),
        ),
      ]),
    ),
  );

  useEffect(() => {
    track(ANALYTICS_EVENTS.exerciseStarted);
  }, []);

  useEffect(() => {
    if (state.message) {
      toast.success(state.message);
      track(ANALYTICS_EVENTS.exerciseCompleted);
      setSaved(true);
      // When the framework does not roll into a commitment, the client is done.
      if (!promptsCommitment) router.push('/app/client');
    }
    if (state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message, state.error]);

  const payload = useMemo(
    () =>
      JSON.stringify({
        entryId,
        responses: steps.map((step) => ({
          stepId: step.id,
          text: answers[step.id]?.text ?? '',
          number: answers[step.id]?.number ?? null,
          choices: answers[step.id]?.choices ?? [],
        })),
      }),
    [answers, entryId, steps],
  );

  const missingRequired = steps.some((step) => {
    if (!step.required) return false;
    const answer = answers[step.id];
    if (!answer) return true;
    if (step.input_type === 'number' || step.input_type === 'slider' || step.input_type === 'scale') {
      return answer.number === null;
    }
    if (step.input_type === 'single_select' || step.input_type === 'multi_select' || step.input_type === 'yes_no') {
      return answer.choices.length === 0;
    }
    return answer.text.trim().length === 0;
  });

  const update = (stepId: string, patch: Partial<Answer>) => {
    setAnswers((current) => ({ ...current, [stepId]: { ...current[stepId], ...patch } }));
  };

  if (saved && promptsCommitment) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">One last thing</h1>
          <p className="mt-1 text-muted-foreground">
            What are you committing to next? This is the part Nellvia watches.
          </p>
        </header>
        <CommitmentForm today={today} tomorrow={tomorrow} />
        <Button variant="ghost" className="w-full" onClick={() => router.push('/app/client')}>
          Skip for now
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{exerciseName}</h1>
        {exerciseDescription ? (
          <p className="mt-1 text-muted-foreground">{exerciseDescription}</p>
        ) : null}
      </header>

      <form action={formAction} className="mt-8 space-y-5">
        <input type="hidden" name="payload" value={payload} />

        {steps.map((step, index) => {
          const config = step.configuration_json ?? {};
          const answer = answers[step.id];

          return (
            <Card key={step.id}>
              <CardContent className="space-y-3 p-5 sm:p-6">
                <div>
                  <Label htmlFor={step.id} className="text-base">
                    {index + 1}. {step.title}
                    {step.required ? <span className="ml-1 text-destructive">*</span> : null}
                  </Label>
                  {step.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                  ) : null}
                </div>

                {step.input_type === 'short_text' ? (
                  <Input
                    id={step.id}
                    value={answer?.text ?? ''}
                    placeholder={config.placeholder}
                    onChange={(event) => update(step.id, { text: event.target.value })}
                  />
                ) : null}

                {step.input_type === 'long_text' ? (
                  <Textarea
                    id={step.id}
                    value={answer?.text ?? ''}
                    placeholder={config.placeholder}
                    className="min-h-[110px] text-base"
                    onChange={(event) => update(step.id, { text: event.target.value })}
                  />
                ) : null}

                {step.input_type === 'number' ? (
                  <Input
                    id={step.id}
                    type="number"
                    value={answer?.number ?? ''}
                    min={config.min}
                    max={config.max}
                    onChange={(event) =>
                      update(step.id, {
                        number: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  />
                ) : null}

                {step.input_type === 'slider' || step.input_type === 'scale' ? (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground">{config.minLabel ?? config.min ?? 0}</span>
                      <span className="text-2xl font-semibold tabular">{answer?.number ?? '—'}</span>
                      <span className="text-sm text-muted-foreground">{config.maxLabel ?? config.max ?? 10}</span>
                    </div>
                    <Slider
                      value={[answer?.number ?? config.min ?? 0]}
                      min={config.min ?? 0}
                      max={config.max ?? 10}
                      step={config.step ?? 1}
                      onValueChange={([value]) => update(step.id, { number: value })}
                      aria-label={step.title}
                    />
                  </div>
                ) : null}

                {step.input_type === 'yes_no' ? (
                  <div className="flex gap-2">
                    {['Yes', 'No'].map((option) => (
                      <Button
                        key={option}
                        type="button"
                        variant={answer?.choices[0] === option ? 'default' : 'outline'}
                        onClick={() => update(step.id, { choices: [option] })}
                      >
                        {option}
                      </Button>
                    ))}
                  </div>
                ) : null}

                {step.input_type === 'single_select' || step.input_type === 'multi_select' ? (
                  <div className="flex flex-wrap gap-2">
                    {(config.options ?? []).map((option) => {
                      const selected = answer?.choices.includes(option) ?? false;
                      return (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            if (step.input_type === 'single_select') {
                              update(step.id, { choices: selected ? [] : [option] });
                              return;
                            }
                            update(step.id, {
                              choices: selected
                                ? (answer?.choices ?? []).filter((choice) => choice !== option)
                                : [...(answer?.choices ?? []), option],
                            });
                          }}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-sm transition-colors',
                            selected
                              ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                              : 'border-border hover:bg-muted/60',
                          )}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}

        <SaveButton disabled={missingRequired} />
      </form>

      <form action={abandonExercise} className="mt-4">
        <input type="hidden" name="entryId" value={entryId} />
        <Button type="submit" variant="ghost" className="w-full">
          Not now
        </Button>
      </form>
    </div>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="xl" className="w-full" disabled={pending || disabled}>
      {pending ? 'Saving…' : 'Save reflection'}
    </Button>
  );
}
