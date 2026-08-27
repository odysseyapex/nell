'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ActionState, inviteCoach } from '@/app/app/coach/actions';

export function InviteCoachForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(inviteCoach, {});

  useEffect(() => {
    if (state.message) toast.success(state.message, { duration: 12_000 });
    if (state.error) toast.error(state.error);
  }, [state.message, state.error]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="coach-first">First name</Label>
          <Input id="coach-first" name="firstName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="coach-last">Last name</Label>
          <Input id="coach-last" name="lastName" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="coach-email">Email</Label>
        <Input id="coach-email" name="email" type="email" required />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sending…' : 'Send invitation'}
    </Button>
  );
}
