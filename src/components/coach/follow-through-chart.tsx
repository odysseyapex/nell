'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Charts are kept deliberately quiet: one series, no gridlines competing with
 * the data, no gradient fills. A coach is reading a shape, not admiring a
 * dashboard. Buckets with too little data are drawn muted rather than hidden,
 * so a thin sample looks thin instead of looking like a finding.
 */

const AXIS = { stroke: 'hsl(220 10% 44%)', fontSize: 12 };

export interface TrendPoint {
  label: string;
  rate: number | null;
  eligible: number;
}

export function FollowThroughTrendChart({ data }: { data: TrendPoint[] }) {
  const points = data.filter((point) => point.rate !== null);

  if (points.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Not enough weeks of history to draw a trend yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="hsl(220 14% 92%)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
          tickLine={false}
          axisLine={false}
          tick={AXIS}
        />
        <Tooltip
          formatter={(value: number, _name, entry) => [
            `${Math.round(value * 100)}% (${entry.payload.eligible} commitments)`,
            'Follow-through',
          ]}
          contentStyle={{ borderRadius: 8, border: '1px solid hsl(220 14% 90%)', fontSize: 13 }}
        />
        <Line
          type="monotone"
          dataKey="rate"
          stroke="var(--brand)"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface BreakdownPoint {
  label: string;
  rate: number | null;
  eligible: number;
}

export function BreakdownChart({ data, minSample = 3 }: { data: BreakdownPoint[]; minSample?: number }) {
  const usable = data.filter((point) => point.rate !== null);
  if (usable.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No resolved commitments yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="hsl(220 14% 92%)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
          tickLine={false}
          axisLine={false}
          tick={AXIS}
        />
        <Tooltip
          cursor={{ fill: 'hsl(220 16% 95%)' }}
          formatter={(value: number, _name, entry) => [
            `${Math.round(value * 100)}% (${entry.payload.eligible} commitments)`,
            'Follow-through',
          ]}
          contentStyle={{ borderRadius: 8, border: '1px solid hsl(220 14% 90%)', fontSize: 13 }}
        />
        <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
          {data.map((point) => (
            <Cell
              key={point.label}
              fill={point.eligible >= minSample ? 'var(--brand)' : 'hsl(220 14% 86%)'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
