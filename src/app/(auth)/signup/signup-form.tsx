'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import { track } from '@/components/shared/analytics-provider';
import { type ActionState, signUpCoach } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? 'Creating your workspace…' : 'Create workspace'}
    </Button>
  );
}

export function SignupForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(signUpCoach, {});

  return (
    <form
      action={formAction}
      onSubmit={() => track(ANALYTICS_EVENTS.coachSignup, { source: 'signup_form' })}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required autoFocus autoComplete="given-name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" autoComplete="family-name" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="organizationName">Business name</Label>
        <Input id="organizationName" name="organizationName" required placeholder="Claire Coaching" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required autoComplete="new-password" minLength={10} />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      </div>

      {state.error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
