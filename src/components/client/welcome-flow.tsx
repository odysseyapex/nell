'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, PencilLine, Repeat, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { completeClientOnboarding } from '@/app/app/actions';
import { NellviaMark } from '@/components/shared/logo';

/**
 * Client onboarding.
 *
 * Four screens, no forms. A client arriving here has been invited by someone
 * they trust and wants to know what this is and what it will ask of them —
 * not to fill in a profile. Settings can wait until they care.
 *
 * The framing throughout is "this helps you notice", never "your coach will
 * see". Both are true; only one of them makes someone want to be honest on a
 * bad day.
 */

const STEPS = [
  {
    icon: PencilLine,
    title: 'Make a commitment',
    body: 'Something specific you intend to do, and how realistic it feels right now.',
  },
  {
    icon: Repeat,
    title: 'Check back later',
    body: 'Tell Nellvia what actually happened. It takes about thirty seconds.',
  },
  {
    icon: Sparkles,
    title: 'Learn from the pattern',
    body: 'Over a few weeks, the conditions that make things easier or harder start to show up.',
  },
];

export function WelcomeFlow({
  firstName,
  coachName,
  organizationName,
  welcomeMessage,
  exerciseName,
}: {
  firstName: string;
  coachName: string | null;
  organizationName: string;
  welcomeMessage: string | null;
  exerciseName: string | null;
}) {
  const [screen, setScreen] = useState(0);

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-lg flex-col justify-center px-5 py-10">
      <div className="mb-8 flex justify-center">
        <div className="flex items-center gap-2 text-[var(--brand)]">
          <NellviaMark className="h-7 w-7" title="Nellvia" />
        </div>
      </div>

      {screen === 0 ? (
        <div className="animate-fade-in space-y-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-lg leading-relaxed text-muted-foreground">
            Nellvia helps you notice what makes following through easier or harder for you.
          </p>
          <p className="text-muted-foreground">
            It is not a scoreboard. There is nothing here to keep up.
          </p>
        </div>
      ) : null}

      {screen === 1 ? (
        <div className="animate-fade-in space-y-6">
          <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
          <ol className="space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card>
                  <CardContent className="flex items-start gap-4 p-5">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                      <step.icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-medium">
                        {index + 1}. {step.title}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {screen === 2 ? (
        <div className="animate-fade-in space-y-6">
          <h1 className="text-2xl font-semibold tracking-tight">Your coach</h1>
          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <p className="text-lg font-medium">{coachName ?? organizationName}</p>
                <p className="text-sm text-muted-foreground">{organizationName}</p>
              </div>
              {welcomeMessage ? (
                <p className="evidence italic">{welcomeMessage}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  What you record here is shared with your coach, so the two of you are looking at
                  the same picture. Honest is more useful than impressive.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {screen === 3 ? (
        <div className="animate-fade-in space-y-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-[hsl(var(--signal-stable))]" />
          <h1 className="text-2xl font-semibold tracking-tight">That&apos;s everything</h1>
          <p className="text-muted-foreground">
            {exerciseName
              ? `Your first thing is ${exerciseName}. It takes a couple of minutes, and it ends with one commitment for tomorrow.`
              : 'Start by making one commitment for tomorrow. Something small and specific.'}
          </p>
        </div>
      ) : null}

      <div className="mt-10 space-y-3">
        {screen < 3 ? (
          <Button size="xl" className="w-full" onClick={() => setScreen((s) => s + 1)}>
            Continue
          </Button>
        ) : (
          <form action={completeClientOnboarding}>
            <StartButton />
          </form>
        )}

        <div className="flex items-center justify-center gap-1.5 pt-2" aria-hidden>
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={`h-1.5 rounded-full transition-all ${
                index === screen ? 'w-6 bg-[var(--brand)]' : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StartButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="xl" className="w-full" disabled={pending}>
      {pending ? 'Setting up…' : 'Get started'}
    </Button>
  );
}
