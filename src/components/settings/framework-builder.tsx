'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import { track } from '@/components/shared/analytics-provider';
import { type ActionState, saveFramework } from '@/app/onboarding/actions';
import type { FrameworkStep, StepInputType } from '@/lib/types';

/**
 * The framework builder.
 *
 * This is where a coach's own methodology becomes structured data. Nellvia ships
 * templates because a blank canvas is where onboarding dies, but every one of
 * them is fully editable text — no coaching method is baked into the product.
 */

const INPUT_TYPES: { value: StepInputType; label: string; hint: string }[] = [
  { value: 'long_text', label: 'Long text', hint: 'A paragraph of reflection' },
  { value: 'short_text', label: 'Short text', hint: 'A line or two' },
  { value: 'scale', label: 'Scale', hint: 'Rate between two ends' },
  { value: 'slider', label: 'Slider', hint: 'A number chosen on a track' },
  { value: 'number', label: 'Number', hint: 'A typed figure' },
  { value: 'yes_no', label: 'Yes / No', hint: 'A binary answer' },
  { value: 'single_select', label: 'Choose one', hint: 'One from a list' },
  { value: 'multi_select', label: 'Choose several', hint: 'Any number from a list' },
];

interface BuilderStep {
  key: string;
  title: string;
  description: string;
  inputType: StepInputType;
  required: boolean;
  options: string;
  min?: number;
  max?: number;
}

const TEMPLATES: { name: string; description: string; steps: Omit<BuilderStep, 'key'>[] }[] = [
  {
    name: 'Pause · Notice · Choose',
    description: 'A reflective loop for moments where behaviour and intention come apart.',
    steps: [
      { title: 'What happened?', description: 'Describe the moment plainly.', inputType: 'long_text', required: true, options: '' },
      { title: 'What were you thinking?', description: 'The thought as it arrived, not the tidied version.', inputType: 'long_text', required: false, options: '' },
      { title: 'How did you feel?', description: '', inputType: 'short_text', required: false, options: '' },
      { title: 'What action did you take?', description: '', inputType: 'long_text', required: true, options: '' },
      { title: 'What do you want to choose next time?', description: '', inputType: 'long_text', required: false, options: '' },
    ],
  },
  {
    name: 'Daily check-in',
    description: 'A short daily reflection that ends in tomorrow’s commitment.',
    steps: [
      { title: 'How did today go?', description: '', inputType: 'scale', required: true, options: '', min: 1, max: 10 },
      { title: 'What helped?', description: '', inputType: 'long_text', required: false, options: '' },
      { title: 'What got in the way?', description: '', inputType: 'long_text', required: false, options: '' },
    ],
  },
  {
    name: 'Weekly review',
    description: 'A wider look back, for use once a week.',
    steps: [
      { title: 'What went well this week?', description: '', inputType: 'long_text', required: true, options: '' },
      { title: 'What was harder than expected?', description: '', inputType: 'long_text', required: false, options: '' },
      { title: 'What conditions made the difference?', description: 'Time of day, people, energy, planning.', inputType: 'long_text', required: false, options: '' },
      { title: 'What is worth changing next week?', description: '', inputType: 'long_text', required: true, options: '' },
    ],
  },
];

function toBuilderStep(step: FrameworkStep): BuilderStep {
  const config = step.configuration_json ?? {};
  return {
    key: step.id,
    title: step.title,
    description: step.description ?? '',
    inputType: step.input_type,
    required: step.required,
    options: (config.options ?? []).join(', '),
    min: config.min,
    max: config.max,
  };
}

let keyCounter = 0;
const newKey = () => `step-${(keyCounter += 1)}-${Math.random().toString(36).slice(2, 7)}`;

export function FrameworkBuilder({
  frameworkId,
  initialName,
  initialDescription,
  initialSteps,
  submitLabel = 'Publish framework',
}: {
  frameworkId?: string;
  initialName?: string;
  initialDescription?: string;
  initialSteps?: FrameworkStep[];
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveFramework, {});
  const [name, setName] = useState(initialName ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [preview, setPreview] = useState(false);
  const [steps, setSteps] = useState<BuilderStep[]>(
    initialSteps?.length ? initialSteps.map(toBuilderStep) : [],
  );

  useEffect(() => {
    if (state.message) {
      toast.success(state.message);
      track(ANALYTICS_EVENTS.frameworkPublished, { count: steps.length });
    }
    if (state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message, state.error]);

  const applyTemplate = (template: (typeof TEMPLATES)[number]) => {
    setName((current) => current || template.name);
    setDescription((current) => current || template.description);
    setSteps(template.steps.map((step) => ({ ...step, key: newKey() })));
  };

  const update = (key: string, patch: Partial<BuilderStep>) => {
    setSteps((current) => current.map((step) => (step.key === key ? { ...step, ...patch } : step)));
  };

  const move = (index: number, direction: -1 | 1) => {
    setSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const payload = JSON.stringify({
    frameworkId: frameworkId ?? '',
    name,
    description,
    publish: true,
    steps: steps.map((step) => ({
      title: step.title,
      description: step.description || undefined,
      inputType: step.inputType,
      required: step.required,
      options: step.options
        ? step.options.split(',').map((option) => option.trim()).filter(Boolean)
        : undefined,
      min: step.min,
      max: step.max,
    })),
  });

  const valid = name.trim().length >= 2 && steps.length > 0 && steps.every((s) => s.title.trim());

  return (
    <div className="space-y-6">
      {steps.length === 0 ? (
        <Card>
          <CardContent className="p-5">
            <p className="font-medium">Start from a template</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Every word is editable afterwards. These are starting points, not Nellvia&apos;s opinion
              about how you should coach.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {TEMPLATES.map((template) => (
                <button
                  key={template.name}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className="rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/60"
                >
                  <p className="font-medium">{template.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{template.steps.length} steps</p>
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              className="mt-4"
              onClick={() =>
                setSteps([
                  {
                    key: newKey(),
                    title: '',
                    description: '',
                    inputType: 'long_text',
                    required: false,
                    options: '',
                  },
                ])
              }
            >
              Or start from scratch
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="framework-name">Framework name</Label>
          <Input
            id="framework-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Pause · Notice · Choose"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="framework-description">Description</Label>
          <Input
            id="framework-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="How you want clients to reflect"
          />
        </div>
      </div>

      {steps.length > 0 ? (
        <div className="space-y-3">
          {steps.map((step, index) => (
            <Card key={step.key}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start gap-3">
                  <span className="mt-2 text-sm font-medium text-muted-foreground tabular">
                    {index + 1}
                  </span>
                  <div className="flex-1 space-y-3">
                    <Input
                      value={step.title}
                      onChange={(event) => update(step.key, { title: event.target.value })}
                      placeholder="What happened?"
                      aria-label={`Step ${index + 1} question`}
                    />
                    <Input
                      value={step.description}
                      onChange={(event) => update(step.key, { description: event.target.value })}
                      placeholder="Optional guidance shown under the question"
                      aria-label={`Step ${index + 1} guidance`}
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs">Answer type</Label>
                        <Select
                          value={step.inputType}
                          onValueChange={(value) => update(step.key, { inputType: value as StepInputType })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {INPUT_TYPES.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-end justify-between gap-3 pb-1">
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`required-${step.key}`}
                            checked={step.required}
                            onCheckedChange={(checked) => update(step.key, { required: checked })}
                          />
                          <Label htmlFor={`required-${step.key}`} className="text-sm">
                            Required
                          </Label>
                        </div>
                        <div className="flex gap-1">
                          <Button type="button" variant="ghost" size="icon" onClick={() => move(index, -1)}>
                            <ArrowUp className="h-4 w-4" />
                            <span className="sr-only">Move up</span>
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => move(index, 1)}>
                            <ArrowDown className="h-4 w-4" />
                            <span className="sr-only">Move down</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setSteps((c) => c.filter((s) => s.key !== step.key))}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Remove step</span>
                          </Button>
                        </div>
                      </div>
                    </div>

                    {step.inputType === 'single_select' || step.inputType === 'multi_select' ? (
                      <Input
                        value={step.options}
                        onChange={(event) => update(step.key, { options: event.target.value })}
                        placeholder="Comma-separated options: Home, Work, Out"
                        aria-label={`Step ${index + 1} options`}
                      />
                    ) : null}

                    {step.inputType === 'scale' || step.inputType === 'slider' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          type="number"
                          value={step.min ?? 1}
                          onChange={(event) => update(step.key, { min: Number(event.target.value) })}
                          aria-label="Minimum"
                        />
                        <Input
                          type="number"
                          value={step.max ?? 10}
                          onChange={(event) => update(step.key, { max: Number(event.target.value) })}
                          aria-label="Maximum"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setSteps((current) => [
                ...current,
                {
                  key: newKey(),
                  title: '',
                  description: '',
                  inputType: 'long_text',
                  required: false,
                  options: '',
                },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Add step
          </Button>
        </div>
      ) : null}

      {preview && steps.length > 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-5 p-6">
            <p className="metric-label">What your client sees</p>
            {steps.map((step, index) => (
              <div key={step.key} className="space-y-2">
                <p className="font-medium">
                  {index + 1}. {step.title || 'Untitled question'}
                  {step.required ? <span className="ml-1 text-destructive">*</span> : null}
                </p>
                {step.description ? (
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                ) : null}
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {INPUT_TYPES.find((type) => type.value === step.inputType)?.hint}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="payload" value={payload} />
        <SubmitButton label={submitLabel} disabled={!valid} />
        <Button type="button" variant="outline" onClick={() => setPreview((current) => !current)}>
          <Eye className="h-4 w-4" /> {preview ? 'Hide preview' : 'Preview'}
        </Button>
        {!valid ? (
          <p className="text-sm text-muted-foreground">
            Give the framework a name and at least one question.
          </p>
        ) : null}
      </form>
    </div>
  );
}

function SubmitButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}
