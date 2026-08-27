import Link from 'next/link';
import { ArrowRight, Compass, LineChart, Microscope, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NellviaLogo } from '@/components/shared/logo';
import { PLANS, PLAN_ORDER, formatPrice } from '@/lib/billing/plans';

const LOOP = [
  { step: 'Commit', detail: 'The client records what they intend to do, and how confident they are.' },
  { step: 'Live', detail: 'Life happens. Nellvia stays out of the way.' },
  { step: 'Check in', detail: 'Thirty seconds: what happened, and what influenced it.' },
  { step: 'Compare', detail: 'Intention against outcome. This gap is the product.' },
  { step: 'Pattern', detail: 'Rules over counted rows surface what recurs.' },
  { step: 'Intervene', detail: 'The coach runs an experiment, and Nellvia measures it.' },
];

const PILLARS = [
  {
    icon: Compass,
    title: 'Know who needs you',
    body: 'Every client is scored on follow-through, trend, engagement and open alerts. The dashboard opens on the people whose numbers moved, not on an alphabetical list.',
  },
  {
    icon: Microscope,
    title: 'Know why',
    body: 'Reasons are captured as structured codes at the moment of the check-in, so "stress appeared before 5 of the last 7 misses" is a count, not an impression.',
  },
  {
    icon: LineChart,
    title: 'Know whether it worked',
    body: 'Turn a pattern into an experiment with a baseline. Nellvia measures the same metric afterwards and tells you plainly whether it moved.',
  },
  {
    icon: ShieldCheck,
    title: 'Built for sensitive data',
    body: 'Row-level security per organization, coaches scoped to assigned clients, and an AI layer that is forbidden from diagnosing, prescribing or inventing.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <NellviaLogo />
          <Badge variant="muted" className="hidden sm:inline-flex">
            Coach intelligence
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Start free</Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-12 sm:pt-20">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              Know which clients need you before they tell you.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
              Nellvia captures what your clients commit to, compares it with what actually happens,
              identifies the patterns behind missed commitments, and gives you a concise view of
              where your attention matters this week.
            </p>
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
              Stop reading every journal. Nellvia surfaces the clients and the patterns that deserve
              your time.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link href="/signup">
                  Start free <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/demo">See the demo workspace</Link>
              </Button>
            </div>
          </div>

          {/* A concrete example beats an abstract promise. */}
          <Card className="mt-16 overflow-hidden border-border/80">
            <CardContent className="p-0">
              <div className="border-b border-border bg-muted/40 px-6 py-3">
                <p className="metric-label">What your dashboard says on a Monday morning</p>
              </div>
              <div className="grid gap-px bg-border sm:grid-cols-3">
                <div className="bg-card p-6">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Sarah Miller</p>
                    <Badge variant="attention">Needs attention</Badge>
                  </div>
                  <p className="mt-4 metric-value">58%</p>
                  <p className="metric-label mt-1">7-day follow-through · was 82%</p>
                  <p className="mt-4 text-sm text-muted-foreground">
                    Work stress was recorded before 5 of the last 7 missed commitments.
                  </p>
                </div>
                <div className="bg-card p-6">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Rachel Cole</p>
                    <Badge variant="watch">Watch</Badge>
                  </div>
                  <p className="mt-4 metric-value">64%</p>
                  <p className="metric-label mt-1">30-day follow-through</p>
                  <p className="mt-4 text-sm text-muted-foreground">
                    Average predicted confidence 91% against 64% actual. Plans may be larger than
                    they look when they are made.
                  </p>
                </div>
                <div className="bg-card p-6">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Amanda Brooks</p>
                    <Badge variant="stable">Stable</Badge>
                  </div>
                  <p className="mt-4 metric-value">92%</p>
                  <p className="metric-label mt-1">30-day follow-through</p>
                  <p className="mt-4 text-sm text-muted-foreground">
                    Consistent for six weeks. A good moment to increase ambition.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="border-y border-border bg-muted/30 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-2xl font-semibold tracking-tight">The loop Nellvia is built around</h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              A commitment is recorded <em>before</em> the behaviour, with a predicted confidence.
              What actually happened is recorded after, with a structured reason. Nellvia never
              collapses those into a single done/not-done flag. The distance between them is the
              entire signal.
            </p>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {LOOP.map((item, index) => (
                <li key={item.step} className="surface p-5">
                  <p className="metric-label">Step {index + 1}</p>
                  <p className="mt-2 font-medium">{item.step}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-6 sm:grid-cols-2">
            {PILLARS.map((pillar) => (
              <Card key={pillar.title}>
                <CardContent className="p-6">
                  <pillar.icon className="h-5 w-5 text-muted-foreground" />
                  <h3 className="mt-4 font-semibold">{pillar.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-muted/30 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-2xl font-semibold tracking-tight">Pricing</h2>
            <p className="mt-3 text-muted-foreground">Priced per coach, by active client roster.</p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLAN_ORDER.map((id) => {
                const plan = PLANS[id];
                return (
                  <Card key={plan.id} className={plan.highlighted ? 'border-foreground/30 shadow-md' : ''}>
                    <CardContent className="flex h-full flex-col p-6">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{plan.name}</p>
                        {plan.highlighted ? <Badge variant="muted">Most chosen</Badge> : null}
                      </div>
                      <p className="mt-4 text-3xl font-semibold tracking-tight tabular">
                        {formatPrice(plan)}
                        <span className="text-sm font-normal text-muted-foreground">/month</span>
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">{plan.tagline}</p>
                      <ul className="mt-5 flex-1 space-y-2 text-sm text-muted-foreground">
                        {plan.features.map((feature) => (
                          <li key={feature}>· {feature}</li>
                        ))}
                      </ul>
                      <Button className="mt-6" variant={plan.highlighted ? 'default' : 'outline'} asChild>
                        <Link href="/signup">Choose {plan.name}</Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-sm text-muted-foreground">
          Nellvia is a coaching support tool. It is not a medical, dietetic, psychological or
          therapeutic service, and it does not diagnose or treat any condition.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">© {new Date().getFullYear()} Nellvia</p>
      </footer>
    </div>
  );
}
