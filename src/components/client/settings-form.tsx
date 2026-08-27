'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { type ActionState, updateClientPreferences } from '@/app/app/actions';

/**
 * Notification settings.
 *
 * Four switches, all on by default and all genuinely optional. The evening
 * nudge only ever fires when something is actually outstanding — a reminder
 * that arrives on a day you already closed out is how people learn to mute an
 * app.
 */
const OPTIONS = [
  {
    name: 'morning',
    label: 'Morning',
    hint: 'A short note if you have something committed for today.',
  },
  {
    name: 'whenDue',
    label: 'When a check-in is due',
    hint: 'At the time you choose below.',
  },
  {
    name: 'eveningNudge',
    label: 'Evening',
    hint: 'Only if you have not closed the loop on the day.',
  },
  {
    name: 'weekly',
    label: 'Weekly',
    hint: 'What Nellvia noticed about your week.',
  },
] as const;

export function ClientSettingsForm({
  preferredCheckinTime,
  notifications,
}: {
  preferredCheckinTime: string;
  notifications: Record<string, boolean | undefined>;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateClientPreferences, {});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    morning: notifications.morning ?? true,
    whenDue: notifications.when_due ?? true,
    eveningNudge: notifications.evening_nudge ?? true,
    weekly: notifications.weekly ?? true,
  });

  useEffect(() => {
    if (state.message) toast.success(state.message);
    if (state.error) toast.error(state.error);
  }, [state.message, state.error]);

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <form action={formAction} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="preferredCheckinTime" className="text-base">
              When would you like to check in?
            </Label>
            <Input
              id="preferredCheckinTime"
              name="preferredCheckinTime"
              type="time"
              defaultValue={preferredCheckinTime}
              className="w-40"
            />
          </div>

          <fieldset className="space-y-4">
            <legend className="text-base font-medium">Reminders</legend>
            {OPTIONS.map((option) => (
              <div key={option.name} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Label htmlFor={option.name}>{option.label}</Label>
                  <p className="mt-0.5 text-sm text-muted-foreground">{option.hint}</p>
                </div>
                <Switch
                  id={option.name}
                  name={option.name}
                  checked={enabled[option.name]}
                  onCheckedChange={(checked) =>
                    setEnabled((current) => ({ ...current, [option.name]: checked }))
                  }
                />
              </div>
            ))}
          </fieldset>

          <SaveButton />
        </form>
      </CardContent>
    </Card>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}
