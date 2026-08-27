'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  type ActionState,
  createExercise,
  saveBrandingStep,
  saveMethodStep,
  saveOrganizationStep,
  saveReasonCodes,
} from '@/app/onboarding/actions';
import { cn } from '@/lib/utils';
import type { ReasonCode } from '@/lib/types';

/**
 * Onboarding step forms.
 *
 * Each one is deliberately short. The goal of onboarding is a coach with one
 * framework, one exercise and one client — not a fully configured workspace.
 */

function Submit({ label, busy = 'Saving…' }: { label: string; busy?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function useToast(state: ActionState) {
  useEffect(() => {
    if (state.message) toast.success(state.message);
    if (state.error) toast.error(state.error);
  }, [state.message, state.error]);
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Berlin',
  'Europe/Madrid',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function OrganizationStep({ name, timezone }: { name: string; timezone: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveOrganizationStep, {});
  const [tz, setTz] = useState(timezone);
  useToast(state);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="timezone" value={tz} />

      <div className="space-y-2">
        <Label htmlFor="name">Business name</Label>
        <Input id="name" name="name" defaultValue={name} required />
        <p className="text-xs text-muted-foreground">Your clients see this everywhere in Nellvia.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="timezone">Timezone</Label>
        <Select value={tz} onValueChange={setTz}>
          <SelectTrigger id="timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Determines what counts as &ldquo;today&rdquo; when Nellvia measures follow-through.
        </p>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Submit label="Continue" />
    </form>
  );
}

const SWATCHES = ['#1F2937', '#0F766E', '#7C3AED', '#B45309', '#B91C1C', '#1D4ED8'];

export function BrandingStep({
  primaryColor,
  secondaryColor,
  welcomeMessage,
  logoUrl,
  redirectTo,
}: {
  primaryColor: string;
  secondaryColor: string;
  welcomeMessage: string;
  logoUrl: string;
  redirectTo?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveBrandingStep, {});
  const [primary, setPrimary] = useState(primaryColor);
  useToast(state);

  return (
    <form action={formAction} className="space-y-6">
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      <div className="space-y-2">
        <Label>Primary colour</Label>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setPrimary(swatch)}
              aria-label={`Use ${swatch}`}
              className={cn(
                'h-9 w-9 rounded-full border-2 transition-transform',
                primary.toLowerCase() === swatch.toLowerCase()
                  ? 'border-foreground scale-110'
                  : 'border-transparent',
              )}
              style={{ background: swatch }}
            />
          ))}
          <Input
            name="primaryColor"
            value={primary}
            onChange={(event) => setPrimary(event.target.value)}
            className="w-32"
            aria-label="Primary colour hex"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="secondaryColor">Secondary colour</Label>
        <Input id="secondaryColor" name="secondaryColor" defaultValue={secondaryColor} className="w-32" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="logoUrl">Logo URL (optional)</Label>
        <Input id="logoUrl" name="logoUrl" type="url" defaultValue={logoUrl} placeholder="https://…" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="welcomeMessage">Welcome message (optional)</Label>
        <Textarea
          id="welcomeMessage"
          name="welcomeMessage"
          defaultValue={welcomeMessage}
          placeholder="Shown in the invitation email and on their first screen."
        />
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Submit label={redirectTo ? 'Save branding' : 'Continue'} />
    </form>
  );
}

export function MethodStep({
  coachPhilosophy,
  preferredTone,
  systemGuidelines,
  terminology,
  forbiddenTopics,
  redirectTo,
}: {
  coachPhilosophy: string;
  preferredTone: string;
  systemGuidelines: string;
  terminology: string;
  forbiddenTopics: string;
  redirectTo?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveMethodStep, {});
  useToast(state);

  return (
    <form action={formAction} className="space-y-6">
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      <div className="space-y-2">
        <Label htmlFor="coachPhilosophy">How would you describe your approach?</Label>
        <Textarea
          id="coachPhilosophy"
          name="coachPhilosophy"
          defaultValue={coachPhilosophy}
          placeholder="Encourage curiosity rather than shame. Behaviour is information, not a verdict."
          className="min-h-[110px]"
        />
        <p className="text-xs text-muted-foreground">
          Nellvia uses this to write in your voice when it summarises for you.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="preferredTone">Tone</Label>
        <Input
          id="preferredTone"
          name="preferredTone"
          defaultValue={preferredTone}
          placeholder="calm, curious, non-judgemental"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="terminology">Your words</Label>
        <Input
          id="terminology"
          name="terminology"
          defaultValue={terminology}
          placeholder="goals=experiments, weigh-in=check-in"
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated pairs. Nellvia will use the word on the right.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="forbiddenTopics">Never raise</Label>
        <Input
          id="forbiddenTopics"
          name="forbiddenTopics"
          defaultValue={forbiddenTopics}
          placeholder="weight targets, calorie counts"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="systemGuidelines">Anything else Nellvia should know</Label>
        <Textarea id="systemGuidelines" name="systemGuidelines" defaultValue={systemGuidelines} />
      </div>

      <div className="evidence">
        Nellvia is prevented from diagnosing, prescribing, or giving medical, psychological or
        nutritional treatment advice regardless of what is written here. These settings shape tone
        and vocabulary, not clinical scope.
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Submit label={redirectTo ? 'Save' : 'Continue'} />
    </form>
  );
}

export function ExerciseStep({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createExercise, {});
  const [frequency, setFrequency] = useState('daily');
  const [prompts, setPrompts] = useState(true);
  useToast(state);

  return (
    <form action={formAction} className="space-y-6">
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
      <input type="hidden" name="frequency" value={frequency} />
      <input type="hidden" name="promptsCommitment" value={prompts ? 'true' : ''} />

      <div className="space-y-2">
        <Label htmlFor="exercise-name">Exercise name</Label>
        <Input id="exercise-name" name="name" defaultValue="Daily Reflection" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="exercise-description">Description</Label>
        <Textarea
          id="exercise-description"
          name="description"
          defaultValue="A short daily look at what happened and what you want to choose next."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="frequency">How often?</Label>
        <Select value={frequency} onValueChange={setFrequency}>
          <SelectTrigger id="frequency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="manual">Whenever they choose</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border p-4">
        <Switch id="prompts" checked={prompts} onCheckedChange={setPrompts} />
        <div>
          <Label htmlFor="prompts">End with a commitment</Label>
          <p className="mt-1 text-sm text-muted-foreground">
            Strongly recommended. The commitment is what Nellvia measures against. A reflection with
            no commitment produces no follow-through data.
          </p>
        </div>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Submit label={redirectTo ? 'Create exercise' : 'Continue'} />
    </form>
  );
}

export function ReasonCodesStep({
  reasonCodes,
  redirectTo,
}: {
  reasonCodes: ReasonCode[];
  redirectTo?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveReasonCodes, {});
  const [deactivated, setDeactivated] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  useToast(state);

  const payload = JSON.stringify({ added, deactivated, redirectTo });

  return (
    <div className="space-y-6">
      <div>
        <p className="font-medium">Reasons your clients can choose from</p>
        <p className="mt-1 text-sm text-muted-foreground">
          These become the structured vocabulary behind every pattern Nellvia finds, so they are worth
          matching to how you actually talk. Turning one off keeps past check-ins intact.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {reasonCodes.map((reason) => {
          const off = deactivated.includes(reason.id);
          return (
            <button
              key={reason.id}
              type="button"
              onClick={() =>
                setDeactivated((current) =>
                  off ? current.filter((id) => id !== reason.id) : [...current, reason.id],
                )
              }
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                off
                  ? 'border-dashed border-border text-muted-foreground line-through'
                  : 'border-[var(--brand)] bg-[var(--brand-soft)]',
              )}
            >
              {reason.name}
            </button>
          );
        })}
        {added.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setAdded((current) => current.filter((item) => item !== name))}
            className="rounded-full border border-[var(--brand)] bg-[var(--brand-soft)] px-3 py-1.5 text-sm"
          >
            {name} ×
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add your own, e.g. Travel day"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (draft.trim()) setAdded((current) => [...current, draft.trim()]);
              setDraft('');
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (draft.trim()) setAdded((current) => [...current, draft.trim()]);
            setDraft('');
          }}
        >
          Add
        </Button>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <form action={formAction}>
        <input type="hidden" name="payload" value={payload} />
        <Submit label={redirectTo ? 'Save reasons' : 'Continue'} />
      </form>
    </div>
  );
}
