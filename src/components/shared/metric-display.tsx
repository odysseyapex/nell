import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { type TrendDirection, formatDelta, formatRate } from '@/lib/metrics';
import { RISK_LABELS } from '@/lib/risk';
import { cn } from '@/lib/utils';
import type { RiskLevel } from '@/lib/types';

/**
 * Shared vocabulary for showing measurements.
 *
 * Two habits are enforced here rather than left to each screen:
 *   - a rate is never shown without the counts behind it
 *   - "no data" is shown as "—" with an explanation, never as 0%
 */

export function MetricCard({
  label,
  value,
  detail,
  trend,
  className,
}: {
  label: string;
  value: string;
  detail?: string;
  trend?: TrendDirection;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <p className="metric-label">{label}</p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="metric-value">{value}</span>
          {trend ? <TrendIcon trend={trend} /> : null}
        </div>
        {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

export function TrendIcon({ trend, className }: { trend: TrendDirection; className?: string }) {
  const map = {
    improving: { Icon: ArrowUpRight, color: 'text-[hsl(var(--signal-stable))]', label: 'Improving' },
    declining: { Icon: ArrowDownRight, color: 'text-[hsl(var(--signal-attention))]', label: 'Declining' },
    steady: { Icon: ArrowRight, color: 'text-muted-foreground', label: 'Steady' },
    unknown: { Icon: Minus, color: 'text-muted-foreground', label: 'Not enough data' },
  } as const;

  const { Icon, color, label } = map[trend];
  return (
    <span className={cn('inline-flex items-center', color, className)} title={label}>
      <Icon className="h-5 w-5" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  const variant = level === 'needs_attention' ? 'attention' : level === 'watch' ? 'watch' : 'stable';
  return <Badge variant={variant}>{RISK_LABELS[level]}</Badge>;
}

export function TrendLabel({ trend, delta }: { trend: TrendDirection; delta: number | null }) {
  if (trend === 'unknown') {
    return <span className="text-sm text-muted-foreground">Not enough data to call a trend</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <TrendIcon trend={trend} />
      <span className="capitalize">{trend}</span>
      <span className="text-muted-foreground tabular">{formatDelta(delta)}</span>
    </span>
  );
}

/**
 * Evidence is always rendered in its own visually distinct block, so a coach
 * can tell at a glance which sentences are counts and which are interpretation.
 */
export function EvidenceList({ statements, title = 'Evidence' }: { statements: string[]; title?: string }) {
  if (statements.length === 0) return null;
  return (
    <div className="evidence">
      <p className="metric-label mb-2">{title}</p>
      <ul className="space-y-1">
        {statements.map((statement) => (
          <li key={statement} className="tabular">
            · {statement}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
