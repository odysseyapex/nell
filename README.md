# Nell

**Know which clients need you before they tell you.**

Nell is a behavioural follow-through intelligence platform for coaches. It captures what clients
commit to *before* the behaviour, records what actually happened *after* it and why, detects
patterns across that history, and tells the coach which clients need attention and what may be
worth exploring.

It is not a CRM, a course platform, a habit tracker or a calorie counter. It is one loop, done
properly:

```
DECIDE → COMMIT → LIVE → CHECK IN → COMPARE → UNDERSTAND
   → IDENTIFY PATTERN → INTERVENE → EXPERIMENT → MEASURE → LEARN
```

The distinction the whole system preserves is **what the client intended to do** versus **what
actually happened**. Nothing in the data model collapses those into a single done/not-done flag.

---

## Table of contents

- [What makes this different](#what-makes-this-different)
- [Architecture](#architecture)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [Demo data](#demo-data)
- [Stripe setup](#stripe-setup)
- [Resend setup](#resend-setup)
- [OpenAI setup](#openai-setup)
- [Scheduled jobs](#scheduled-jobs)
- [Local development](#local-development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security notes](#security-notes)
- [Safety and scope](#safety-and-scope)
- [Project structure](#project-structure)

---

## What makes this different

Four things, and they are all in the data model rather than the marketing:

1. **A prediction recorded before the behaviour.** Every commitment carries the client's own
   confidence, 0–100, captured at the moment of committing. Without that, follow-through is just a
   completion rate. With it, you can show a client that they average 91% predicted against 63%
   actual — which is a conversation about commitment size, not motivation.

2. **A structured reason for every deviation.** "What influenced that?" is a reason code, not free
   text, so "stress appeared before 5 of the last 7 missed commitments" is a count rather than an
   impression.

3. **Deterministic pattern detection.** Patterns come from rules over counted rows with minimum
   sample sizes — never from a model's reading of a journal. AI rewrites the wording; it cannot
   invent a pattern, change a number, or lower a threshold.

4. **Interventions that get measured.** A pattern can become an experiment with a baseline recorded
   at the moment it starts. When it closes, Nell measures the same metric over an equal-length
   window and reports the result plainly, including when it did not work.

### Metric definitions

| Term | Definition |
| --- | --- |
| **eligible** | A commitment that has resolved: completed, changed or missed. Cancelled and still-planned commitments are excluded, so an open commitment is never counted as a failure. |
| **follow-through** | `completed / eligible`. A change is not a completion, but it is not a miss either — change rate and miss rate are reported separately rather than folded in. |
| **trend** | 30-day follow-through against the preceding 30 days, in rate points. Reported as `unknown` below three resolved commitments per window rather than guessed. |
| **calibration gap** | Mean predicted confidence minus actual follow-through, over the same commitments. |
| **risk** | A transparent additive score (see `src/lib/risk`). Every point carries the sentence that explains it, and the coach always sees the sentences. |

A rate with nothing to divide by is `null`, and renders as `—`. It is never shown as 0%.

---

## Architecture

Multi-tenant SaaS. Every customer is an **organization**; every tenant-owned row carries
`organization_id` and is protected by Postgres Row Level Security.

```
Next.js (App Router, RSC + server actions)
  ├── src/lib/metrics      pure functions — follow-through, calibration, trends, breakdowns
  ├── src/lib/patterns     deterministic rule engine over counted rows
  ├── src/lib/risk         transparent additive risk scoring
  ├── src/lib/alerts       coach alert generation with stable keys
  ├── src/lib/ai           OpenAI, server-only, Zod-validated, with a deterministic fallback
  ├── src/lib/jobs         nightly intelligence pass, weekly coach email
  └── src/lib/data         RLS-bound reads that feed the pure layers
        │
Supabase (Postgres + Auth + RLS)
```

**The database calculates facts. AI interprets facts.** The model is never asked to count, divide
or compare. Every figure it puts into words was computed by `src/lib/metrics` first.

### Roles

| Role | Sees |
| --- | --- |
| `super_admin` | Workspace shape only — size, plan, health, AI spend. No client content, no impersonation. |
| `organization_owner` | Everything in their own organization. |
| `coach` | Only clients explicitly assigned to them. |
| `client` | Only their own data. Never alerts, risk levels, briefs or coach notes. |

### Stack

Next.js · TypeScript · React · Tailwind · shadcn-style components on Radix · Supabase (Postgres,
Auth, RLS) · Zod · TanStack Table · Recharts · date-fns · OpenAI · Stripe · Resend · PostHog ·
Sentry · Vitest · Playwright · Vercel.

Responsive and mobile-first, with a PWA manifest and installable icons already in place.

---

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values
npm run dev
```

Nell's core loop needs only Supabase. OpenAI, Stripe, Resend, PostHog and Sentry are all optional
and the product degrades honestly without them — see [Environment variables](#environment-variables).
`/app/settings` shows which integrations are actually connected.

---

## Environment variables

Copy `.env.example` to `.env.local`.

**Required**

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key. Safe in the browser; RLS does the work. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Bypasses RLS. Needed for signup, invitations, webhooks, the nightly job and seeding. |

**Optional**

| Variable | Behaviour when absent |
| --- | --- |
| `OPENAI_API_KEY` | Briefs and insights are composed deterministically from the same data. Fully functional, plainer prose. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | Plan changes are unavailable; run workspaces in `pilot_mode`. |
| `RESEND_API_KEY` | Invitations return a copyable link instead of sending an email. Nothing fails silently. |
| `NEXT_PUBLIC_POSTHOG_KEY` | No analytics. |
| `SENTRY_DSN` | No error tracking. |
| `CRON_SECRET` | Scheduled job endpoints answer 503 rather than running unauthenticated. |

Validation is lazy and at the point of use, so `next build` never needs production secrets.

---

## Supabase setup

1. Create a Supabase project.
2. Under **Authentication → Providers → Email**, disable "Confirm email" for development. Signup
   and invitation acceptance sign the user in immediately; with confirmation on, they will need to
   click a link first.
3. Apply the migrations in order. Either paste each file into the SQL editor, or with the Supabase
   CLI linked to your project:

   ```bash
   supabase db push
   ```

   | Migration | Contents |
   | --- | --- |
   | `0001_core.sql` | Organizations, profiles, coach assignments, RLS helper functions |
   | `0002_frameworks.sql` | Frameworks, steps, exercises, assignments, entries, responses |
   | `0003_commitments.sql` | Commitments, reason codes, check-ins, status trigger |
   | `0004_intelligence.sql` | Patterns, alerts, snapshots, briefs, experiments, notes |
   | `0005_settings_ops.sql` | AI settings, invitations, audit log, AI usage |
   | `0006_rls.sql` | Row Level Security policies for every tenant table |
   | `0007_views.sql` | `commitment_facts` view and plan-limit helper |

4. Confirm RLS is on: every table in `0006_rls.sql` should show "RLS enabled" in the dashboard.

To create a platform admin, insert a `profiles` row with `role = 'super_admin'` and
`organization_id = null` for an existing auth user.

---

## Demo data

```bash
npm run db:seed      # create the demo workspace
npm run db:reset     # delete and rebuild it
```

This creates **Claire Coaching** with a coach and four clients, each carrying 90 days of
deterministic synthetic history designed to produce four different, recognisable stories:

| Client | Story | What Nell should say |
| --- | --- | --- |
| Sarah Miller | Strong for two months, declining for the last four weeks | Follow-through down; work stress dominates recent misses → **Needs attention** |
| Jessica Lane | Reliable on weekdays, falls away at weekends | Weekend dip pattern; has an active experiment running |
| Amanda Brooks | Consistently above 90% | **Stable.** Nell says almost nothing — which is the point |
| Rachel Cole | Predicts ~90%, delivers ~60% | Overconfidence pattern; a completed experiment that worked |

Ninety days are generated because trend detection compares the last 30 days against the 30 before
them — a single month can show a rate but cannot show a change. The generator is seeded, so every
run produces identical history and the demo never drifts.

The seed finishes by running the real nightly job, so stored patterns, alerts and risk snapshots
are produced by production code rather than hand-written. (That reuse is why the script runs under
`node --conditions=react-server` — the jobs it calls are marked `server-only`.)

```
Coach     claire@clairecoaching.demo
Clients   sarah@ / jessica@ / amanda@ / rachel@clairecoaching.demo
Password  nell-demo-2026
```

**The 60-second demo.** Sign in as Claire → the dashboard opens on clients who need attention →
click Sarah → see 7-day and 30-day follow-through with the trend → read the pattern and the counted
evidence behind it → read the suggested coaching question → start the suggested experiment.

---

## Stripe setup

1. Create four recurring monthly prices matching `src/lib/billing/plans.ts` (Starter $49 / Coach $99
   / Pro $199 / Scale $399) and set `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_COACH`, `STRIPE_PRICE_PRO`,
   `STRIPE_PRICE_SCALE`.
2. Add a webhook endpoint at `https://your-domain/api/stripe/webhook` for:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`.
3. Set `STRIPE_WEBHOOK_SECRET`.

Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

Prices and limits live only in `src/lib/billing/plans.ts` — the marketing page, billing screen,
invite guard and checkout all read from there.

**Pilot mode.** Setting `pilot_mode = true` on an organization exempts it from client limits and
billing entirely, so founding partners can be onboarded by hand before any payment relationship
exists. The demo workspace ships in pilot mode.

---

## Resend setup

Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (a verified sending domain). Nell sends: coach welcome,
client invitation, check-in reminder, weekly client summary, and the weekly coach attention email.

The weekly coach email is the main retention surface. It sends **only when there is something to
say** — a coach who gets "nothing to report" every week learns to ignore the one that matters.

---

## OpenAI setup

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` (default `gpt-4o-mini`). All calls are
server-side; the key is read through `serverEnv()`, which throws if reached from the browser.

Every response is validated against a Zod schema before it is stored (`src/lib/ai/schemas.ts`), and
every prompt carries the hard rules in `src/lib/ai/prompts.ts`: use only supplied evidence, never
perform arithmetic, distinguish correlation from causation, never diagnose or prescribe, never
shame. Coach configuration is applied *within* those rules and the precedence is stated explicitly,
so a coach's philosophy field cannot function as a prompt injection.

Pattern wording is generated **once, when a pattern first appears**, and stored on the row. Rewriting every pattern nightly would multiply the model bill by the number of clients for no benefit — the underlying finding has not changed.

If a call fails or the key is absent, Nell falls back to `composeBriefDeterministic` — the same
brief, assembled from the same computed values, in plainer prose. The AI path improves the writing;
it never supplies the substance.

---

## Scheduled jobs

| Endpoint | Schedule | Job |
| --- | --- | --- |
| `POST /api/cron/nightly` | daily 06:00 UTC | Recomputes patterns, opens and auto-resolves alerts, writes risk snapshots |
| `POST /api/cron/client-reminders` | daily 16:00 UTC | One nudge per client with an outstanding check-in, at most |
| `POST /api/cron/weekly-coach-email` | Mondays 12:00 UTC | Each coach's attention summary, and each client's own week back |

Both require `Authorization: Bearer $CRON_SECRET` and answer 503 when `CRON_SECRET` is unset.
`vercel.json` wires up both schedules.

Detection also runs live on every page load, so the nightly job is not what makes patterns appear.
It exists to give findings **continuity**: a stable identity a coach can dismiss, an alert that can
be marked handled, and a day-over-day record so "what changed" is answerable at all. A dismissed
pattern is never resurrected by a later run; a condition that clears resolves its own alert.

---

## Local development

```bash
npm run dev          # dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest unit tests
npm run test:e2e     # playwright
npm run build        # production build
```

---

## Testing

**Unit tests** (`tests/unit`, 68 tests) cover the parts where a silent error would be invisible and
expensive: metric calculations and their window boundaries, every pattern rule including the cases
where it must *not* fire, risk scoring, alert generation, plan limits, token hashing, rate limiting,
and the AI output contracts and safety prompt.

They run without a database — the metric, pattern and risk layers are pure functions over typed
rows, which is what makes them testable at all.

**End-to-end tests** (`e2e`) split in two:

- `public.spec.ts` — runs anywhere with no data. The marketing surface, the auth screens, and the
  access-control guarantees: every protected path redirects when signed out, API routes answer 401,
  the cron endpoints refuse an unauthenticated call, and the Stripe webhook refuses an unsigned
  payload.
- `journey.spec.ts` — the full loop against the seeded demo. Skipped unless explicitly enabled, so
  a machine without a database gets a green suite that is honest about what it did not exercise:

  ```bash
  NELL_E2E_DEMO=1 npm run test:e2e
  ```

  Covers the coach dashboard leading with attention, patterns showing their evidence, starting an
  experiment with a baseline, generating a brief, the client commitment and check-in flows, and the
  role boundaries — a client cannot reach the coach dashboard, settings, the admin console, or
  another client's page.

---

## Deployment

Vercel, with the environment variables above set for the target environment.

1. Apply the migrations to your production Supabase project.
2. Set the environment variables, including `CRON_SECRET`.
3. Deploy. `vercel.json` registers both cron schedules.
4. Add the Stripe webhook endpoint and set `STRIPE_WEBHOOK_SECRET`.
5. Set `NEXT_PUBLIC_APP_URL` to the production URL — invitation links are built from it.

---

## Security notes

Nell holds behavioural material about real people, often about eating, weight and emotion. The
posture is accordingly conservative.

- **Row Level Security on every tenant table**, with explicit policies. There is no default-allow
  anywhere. Tenancy is always derived from `auth.uid()` via `SECURITY DEFINER` helpers — the
  application never supplies its own `organization_id` to a policy.
- **Coaches are scoped to assigned clients** through `coach_client_assignments`, enforced in the
  database rather than only in the UI.
- **Clients cannot read coach-private material.** Alerts, risk snapshots, briefs and coach notes
  have no client-side policy at all, so it cannot leak through a query mistake.
- **Defence in depth.** Server guards resolve role and organization from the session; RLS enforces
  the same rules underneath. An id for another tenant returns no row, so "not yours" and "does not
  exist" are indistinguishable from outside.
- **The service-role client is used in five documented places only** — signup, invitation
  acceptance, Stripe webhooks, the nightly job, and seeding. It is never used to serve a request on
  behalf of a signed-in user.
- **Fail closed.** If Supabase cannot be reached to verify a session, there is no session:
  protected routes redirect and API routes answer 401 rather than rendering.
- **Invitations store only a SHA-256 hash.** The raw token exists solely in the email, so a database
  leak yields nothing redeemable. Single use, 14-day expiry.
- **Rate limiting** on sign-in, signup, invitations and AI generation. This is an in-process counter
  — a deliberate MVP trade-off that stops a runaway loop burning the OpenAI key without adding
  Redis. Move it to a shared store before relying on it as a security control.
- **No client content leaves the database.** PostHog autocapture is disabled (it records the text of
  clicked elements, which on these screens would be exactly the material we promise to protect);
  analytics events carry ids, counts and enums only. Sentry has `sendDefaultPii: false` and strips
  request bodies and cookies. The AI usage table records token counts and outcomes, never prompts.
- **Audit logging** for framework publication, invitations, notes, experiments, settings changes and
  subscription events — actions, never journal content.
- **No impersonation** in the admin console, by choice. The operational questions it answers do not
  require reading anyone's reflections, and building the capability would make the privacy promise
  conditional on our restraint.

---

## Safety and scope

Nell is a coaching support tool. It is **not** a medical, dietetic, psychological or therapeutic
service, and it does not diagnose or treat any condition. This is stated on the marketing page and
on the invitation screen, and it is enforced in the AI layer rather than left to tone: the prompt
rules explicitly forbid diagnosing, naming conditions, commenting on medication, prescribing
calories, macros, fasting or training loads, and any shaming language.

Language throughout is associative rather than causal — "appears alongside", "may be worth
exploring" — because that is what the data supports. A rule that fires below its minimum sample size
would produce confident-sounding nonsense, so Nell says nothing instead.

---

## Project structure

```
src/
  app/
    (auth)/            login, signup, server actions
    invite/[token]/    invitation acceptance
    onboarding/        seven-step coach setup
    app/
      coach/           dashboard, client list, client detail, experiments
      today/           client home — check-ins, reflection, commitment
      commitments/     client commitment history
      insights/        client-facing patterns
      history/         the client's own record
      exercise/        framework runner
      settings/        framework, exercises, reasons, method, branding, team, billing
    admin/             platform console
    api/               stripe checkout/portal/webhook, cron jobs
  components/
    ui/                shadcn-style primitives on Radix
    coach/ client/ settings/ onboarding/ shared/
  lib/
    metrics/ patterns/ risk/ alerts/    the intelligence core (pure)
    ai/ data/ jobs/ email/ billing/     integrations and orchestration
    auth/ supabase/                     session, guards, clients
supabase/migrations/   ordered SQL
scripts/seed.ts        demo data
tests/unit/            vitest
e2e/                   playwright
```

### Deliberately not built

Full CRM, calendar or video replacement, course hosting, community or group chat, nutrition
database, calorie or macro tracking, workout programming, wearables, marketplace, native apps,
public profiles. The architecture leaves room for coach knowledge bases, RAG over methodology,
integrations and a public API — none of it is implemented until it is validated.
