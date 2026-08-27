'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * History.
 *
 * A plain timeline of what was decided and what happened. No charts, no
 * scores, no run-lengths — just the record, filterable four ways.
 *
 * "Didn't happen" is styled the same weight as everything else on purpose. A
 * timeline that makes some days look like red marks against you is a timeline
 * people stop opening.
 */

export interface HistoryItem {
  id: string;
  date: string;
  text: string;
  status: 'completed' | 'changed' | 'missed' | 'planned' | 'cancelled';
  reason: string | null;
  category: string | null;
  confidence: number | null;
}

type Filter = 'all' | 'completed' | 'changed' | 'missed';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'completed', label: 'Went to plan' },
  { value: 'changed', label: 'Changed' },
  { value: 'missed', label: "Didn't happen" },
];

const STATUS_LABEL: Record<HistoryItem['status'], string> = {
  completed: 'Went to plan',
  changed: 'Changed',
  missed: "Didn't happen",
  planned: 'Still open',
  cancelled: 'Cancelled',
};

const STATUS_VARIANT: Record<HistoryItem['status'], 'stable' | 'watch' | 'muted'> = {
  completed: 'stable',
  changed: 'watch',
  missed: 'muted',
  planned: 'muted',
  cancelled: 'muted',
};

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(parsed);
}

export function HistoryTimeline({ items }: { items: HistoryItem[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState<string>('all');

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category).filter((c): c is string => Boolean(c)))].sort(),
    [items],
  );

  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (filter !== 'all' && item.status !== filter) return false;
        if (category !== 'all' && item.category !== category) return false;
        return true;
      }),
    [items, filter, category],
  );

  const days = useMemo(() => {
    const grouped = new Map<string, HistoryItem[]>();
    for (const item of visible) {
      grouped.set(item.date, [...(grouped.get(item.date) ?? []), item]);
    }
    return [...grouped.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? 'default' : 'outline'}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={category === 'all' ? 'secondary' : 'ghost'}
              onClick={() => setCategory('all')}
            >
              All areas
            </Button>
            {categories.map((option) => (
              <Button
                key={option}
                size="sm"
                variant={category === option ? 'secondary' : 'ghost'}
                onClick={() => setCategory(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {days.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          Nothing here with that filter.
        </p>
      ) : (
        <div className="space-y-6" role="region" aria-label="Recorded commitments">
          {days.map(([date, entries]) => (
            <section key={date} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {formatDate(date)}
              </h2>
              {entries.map((item) => (
                <Card key={item.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="min-w-0 font-medium">{item.text}</p>
                      <Badge variant={STATUS_VARIANT[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                    </div>
                    {item.reason ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        What influenced it: {item.reason}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
