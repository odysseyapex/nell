'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUpDown, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RiskBadge, TrendIcon } from '@/components/shared/metric-display';
import { type TrendDirection, formatDelta, formatRate } from '@/lib/metrics';
import { RISK_ORDER } from '@/lib/risk';
import { cn } from '@/lib/utils';
import type { ProfileStatus, RiskLevel } from '@/lib/types';

export interface ClientRow {
  id: string;
  name: string;
  email: string;
  coachName: string | null;
  status: ProfileStatus;
  followThrough7: number | null;
  followThrough7Counts: string;
  followThrough30: number | null;
  followThrough30Counts: string;
  trend: TrendDirection;
  trendDelta: number | null;
  risk: RiskLevel;
  riskReason: string | null;
  daysSinceActivity: number | null;
  openAlerts: number;
}

type RiskFilter = 'all' | RiskLevel;

const RISK_FILTERS: { value: RiskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'watch', label: 'Watch' },
  { value: 'stable', label: 'Stable' },
];

function RateCell({ rate, counts }: { rate: number | null; counts: string }) {
  if (rate === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular">
      {formatRate(rate)} <span className="text-xs text-muted-foreground">{counts}</span>
    </span>
  );
}

export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  // Default sort puts the people who need attention at the top: an
  // alphabetical roster makes the coach do the triage Nellvia exists to do.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'risk', desc: false }]);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');

  const columns = useMemo<ColumnDef<ClientRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Client',
        cell: ({ row }) => (
          <div className="min-w-[10rem]">
            <Link href={`/app/coach/clients/${row.original.id}`} className="font-medium hover:underline">
              {row.original.name}
            </Link>
            {row.original.status === 'invited' ? (
              <Badge variant="muted" className="ml-2">
                Invited
              </Badge>
            ) : null}
            {row.original.riskReason ? (
              <p className="mt-0.5 max-w-sm text-xs text-muted-foreground">{row.original.riskReason}</p>
            ) : null}
          </div>
        ),
      },
      { accessorKey: 'coachName', header: 'Coach', cell: ({ getValue }) => getValue<string>() ?? '—' },
      {
        accessorKey: 'followThrough7',
        header: '7-day',
        sortUndefined: 'last',
        cell: ({ row }) => (
          <RateCell rate={row.original.followThrough7} counts={row.original.followThrough7Counts} />
        ),
      },
      {
        accessorKey: 'followThrough30',
        header: '30-day',
        cell: ({ row }) => (
          <RateCell rate={row.original.followThrough30} counts={row.original.followThrough30Counts} />
        ),
      },
      {
        accessorKey: 'trend',
        header: 'Trend',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <TrendIcon trend={row.original.trend} />
            <span className="text-xs text-muted-foreground tabular">
              {row.original.trend === 'unknown' ? '—' : formatDelta(row.original.trendDelta)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'risk',
        header: 'Status',
        sortingFn: (a, b) => RISK_ORDER[a.original.risk] - RISK_ORDER[b.original.risk],
        cell: ({ row }) => <RiskBadge level={row.original.risk} />,
      },
      {
        accessorKey: 'daysSinceActivity',
        header: 'Last active',
        cell: ({ row }) => {
          const days = row.original.daysSinceActivity;
          if (days === null) return <span className="text-muted-foreground">Never</span>;
          return (
            <span className={cn('tabular', days >= 7 && 'text-[hsl(var(--signal-attention))]')}>
              {days === 0 ? 'Today' : `${days}d ago`}
            </span>
          );
        },
      },
      {
        accessorKey: 'openAlerts',
        header: 'Alerts',
        cell: ({ getValue }) => {
          const count = getValue<number>();
          return count === 0 ? <span className="text-muted-foreground">—</span> : <Badge variant="muted">{count}</Badge>;
        },
      },
    ],
    [],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (riskFilter !== 'all' && row.risk !== riskFilter) return false;
      if (!term) return true;
      return row.name.toLowerCase().includes(term) || row.email.toLowerCase().includes(term);
    });
  }, [rows, search, riskFilter]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clients"
            className="pl-9"
            aria-label="Search clients"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {RISK_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={riskFilter === filter.value ? 'default' : 'outline'}
              onClick={() => setRiskFilter(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="surface overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <ArrowUpDown className="h-3 w-3 opacity-50" />
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-12 text-center text-muted-foreground">
                  {rows.length === 0
                    ? 'No clients yet. Invite one to start collecting commitments.'
                    : 'No clients match this filter.'}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
