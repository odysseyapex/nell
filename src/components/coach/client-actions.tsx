'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { FlaskConical, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import { track } from '@/components/shared/analytics-provider';
import {
  type ActionState,
  addCoachNote,
  completeExperiment,
  createExperiment,
  generateCoachingBrief,
  resolveAlert,
  updatePatternStatus,
} from '@/app/app/coach/actions';

/**
 * The client-page mutations, grouped because they share one behaviour: an
 * action result is surfaced as a toast and nothing is optimistically assumed.
 * A coach should never see a change on screen that did not reach the database.
 */

function useActionToast(state: ActionState, onSuccess?: () => void) {
  useEffect(() => {
    if (state.message) {
      toast.success(state.message, { duration: 8000 });
      onSuccess?.();
    }
    if (state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message, state.error]);
}

function Pending({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? busy : idle}</>;
}

// ---------------------------------------------------------------------------

export function GenerateBriefButton({ clientId }: { clientId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(generateCoachingBrief, {});
  useActionToast(state, () => track(ANALYTICS_EVENTS.coachBriefGenerated));

  return (
    <form action={formAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <Button type="submit" variant="outline">
        <Sparkles className="h-4 w-4" />
        <Pending idle="Generate brief" busy="Generating…" />
      </Button>
    </form>
  );
}

export function CoachNoteForm({ clientId }: { clientId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addCoachNote, {});
  const [body, setBody] = useState('');
  useActionToast(state, () => setBody(''));

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <Textarea
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="What do you want to remember before the next call?"
        required
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Private to your team. Clients never see notes.</p>
        <Button type="submit" size="sm" disabled={body.trim().length === 0}>
          <Pending idle="Save note" busy="Saving…" />
        </Button>
      </div>
    </form>
  );
}

export function ResolveAlertButton({ alertId }: { alertId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(resolveAlert, {});
  useActionToast(state);

  return (
    <form action={formAction}>
      <input type="hidden" name="alertId" value={alertId} />
      <Button type="submit" variant="ghost" size="sm">
        <Pending idle="Mark handled" busy="Saving…" />
      </Button>
    </form>
  );
}

export function PatternStatusButtons({ patternId, status }: { patternId: string; status: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updatePatternStatus, {});
  useActionToast(state);

  return (
    <div className="flex gap-2">
      {status !== 'active' ? (
        <form action={formAction}>
          <input type="hidden" name="patternId" value={patternId} />
          <input type="hidden" name="status" value="active" />
          <Button type="submit" variant="outline" size="sm">
            Confirm with client
          </Button>
        </form>
      ) : null}
      <form action={formAction}>
        <input type="hidden" name="patternId" value={patternId} />
        <input type="hidden" name="status" value="dismissed" />
        <Button type="submit" variant="ghost" size="sm">
          Dismiss
        </Button>
      </form>
    </div>
  );
}

export function CompleteExperimentButton({ experimentId }: { experimentId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(completeExperiment, {});
  useActionToast(state, () => track(ANALYTICS_EVENTS.experimentCompleted));

  return (
    <form action={formAction}>
      <input type="hidden" name="experimentId" value={experimentId} />
      <Button type="submit" variant="outline" size="sm">
        <Pending idle="Close and measure" busy="Measuring…" />
      </Button>
    </form>
  );
}

export function StartExperimentDialog({
  clientId,
  patternId,
  suggestedTitle,
  suggestedHypothesis,
  suggestedIntervention,
  triggerLabel = 'Start experiment',
  variant = 'default',
}: {
  clientId: string;
  patternId?: string;
  suggestedTitle?: string;
  suggestedHypothesis?: string;
  suggestedIntervention?: string;
  triggerLabel?: string;
  variant?: 'default' | 'outline' | 'ghost';
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(createExperiment, {});
  useActionToast(state, () => {
    track(ANALYTICS_EVENTS.experimentCreated);
    setOpen(false);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          <FlaskConical className="h-4 w-4" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start an experiment</DialogTitle>
          <DialogDescription>
            Nellvia records today&apos;s follow-through as the baseline and measures the same figure over the
            same length of window when you close it.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="clientId" value={clientId} />
          {patternId ? <input type="hidden" name="patternId" value={patternId} /> : null}

          <div className="space-y-2">
            <Label htmlFor="title">Name</Label>
            <Input id="title" name="title" defaultValue={suggestedTitle} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="hypothesis">Hypothesis</Label>
            <Textarea
              id="hypothesis"
              name="hypothesis"
              defaultValue={suggestedHypothesis}
              placeholder="What do you think is going on?"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="intervention">Intervention</Label>
            <Textarea
              id="intervention"
              name="intervention"
              defaultValue={suggestedIntervention}
              placeholder="What will change, and for how long?"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="durationDays">Duration (days)</Label>
            <Input
              id="durationDays"
              name="durationDays"
              type="number"
              min={3}
              max={90}
              defaultValue={14}
              required
            />
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              <Pending idle="Start experiment" busy="Starting…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
