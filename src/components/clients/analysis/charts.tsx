"use client";

import {
  Area,
  AreaChart,
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
} from "recharts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ============================================================================
// Analysis charts — recharts (existing repo lib). Read-only presentation of
// pre-aggregated daily data passed from the server.
// ============================================================================

function currencyCompact(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function currencyFull(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function multiplier(value: number): string {
  return `${value.toFixed(2)}x`;
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  padding: "8px 10px",
};

interface TrendPoint {
  date: string;
  label: string;
  spend: number;
  roas: number;
  cpa: number;
  provisional: boolean;
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className='p-6'>
      <div className='mb-1'>
        <h3 className='text-base font-semibold'>{title}</h3>
        {subtitle && (
          <p className='text-xs text-muted-foreground'>{subtitle}</p>
        )}
      </div>
      <div className='mt-4 h-[280px] w-full'>{children}</div>
    </Card>
  );
}

function TrendTooltip({
  active,
  payload,
  rows,
}: {
  active?: boolean;
  payload?: Array<{ payload: TrendPoint }>;
  rows: Array<{
    key: keyof TrendPoint;
    label: string;
    format: (v: number) => string;
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <p className='mb-1 font-medium'>{point.label}</p>
      {rows.map((r) => (
        <p key={r.key} className='text-muted-foreground'>
          {r.label}: {r.format(point[r.key] as number)}
        </p>
      ))}
      {point.provisional && (
        <p className='mt-1 text-[11px] text-amber-400'>
          Provisional — recent day, may still update.
        </p>
      )}
    </div>
  );
}

export function SpendTrendChart({
  data,
  currency,
}: {
  data: TrendPoint[];
  currency: string;
}) {
  return (
    <ChartCard title='Spend over time' subtitle='Daily spend'>
      <ResponsiveContainer width='100%' height='100%'>
        <AreaChart
          data={data}
          margin={{ top: 10, right: 10, left: -4, bottom: 0 }}>
          <defs>
            <linearGradient id='analysisSpend' x1='0' y1='0' x2='0' y2='1'>
              <stop
                offset='5%'
                stopColor='hsl(var(--primary))'
                stopOpacity={0.4}
              />
              <stop
                offset='95%'
                stopColor='hsl(var(--primary))'
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray='3 3' vertical={false} />
          <XAxis
            dataKey='label'
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v) => currencyCompact(v, currency)}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            width={56}
          />
          <Tooltip
            content={
              <TrendTooltip
                rows={[
                  {
                    key: "spend",
                    label: "Spend",
                    format: (v) => currencyFull(v, currency),
                  },
                ]}
              />
            }
          />
          <Area
            type='monotone'
            dataKey='spend'
            stroke='hsl(var(--primary))'
            strokeWidth={2}
            fill='url(#analysisSpend)'
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function RoasTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ChartCard title='Meta ROAS over time' subtitle='Meta-reported, daily'>
      <ResponsiveContainer width='100%' height='100%'>
        <LineChart
          data={data}
          margin={{ top: 10, right: 10, left: -4, bottom: 0 }}>
          <CartesianGrid strokeDasharray='3 3' vertical={false} />
          <XAxis
            dataKey='label'
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v) => `${v.toFixed(1)}x`}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            width={44}
          />
          <Tooltip
            content={
              <TrendTooltip
                rows={[{ key: "roas", label: "Meta ROAS", format: multiplier }]}
              />
            }
          />
          <Line
            type='monotone'
            dataKey='roas'
            stroke='hsl(var(--primary))'
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CpaRoasTrendChart({
  data,
  currency,
  subtitle,
}: {
  data: TrendPoint[];
  currency: string;
  subtitle?: string;
}) {
  return (
    <ChartCard
      title='Meta CPA + ROAS over time'
      subtitle={subtitle ?? "Meta-reported, dual axis"}>
      <ResponsiveContainer width='100%' height='100%'>
        <LineChart
          data={data}
          margin={{ top: 10, right: 8, left: -4, bottom: 0 }}>
          <CartesianGrid strokeDasharray='3 3' vertical={false} />
          <XAxis
            dataKey='label'
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis
            yAxisId='cpa'
            tickFormatter={(v) => currencyCompact(v, currency)}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            width={56}
          />
          <YAxis
            yAxisId='roas'
            orientation='right'
            tickFormatter={(v) => `${v.toFixed(1)}x`}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            width={44}
          />
          <Tooltip
            content={
              <TrendTooltip
                rows={[
                  {
                    key: "cpa",
                    label: "Meta CPA",
                    format: (v) => currencyFull(v, currency),
                  },
                  { key: "roas", label: "Meta ROAS", format: multiplier },
                ]}
              />
            }
          />
          <Line
            yAxisId='cpa'
            type='monotone'
            dataKey='cpa'
            stroke='hsl(var(--destructive))'
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId='roas'
            type='monotone'
            dataKey='roas'
            stroke='hsl(var(--primary))'
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

interface BreakdownDatum {
  name: string;
  value: number;
  isOthers: boolean;
}

export function BreakdownBarChart({
  title,
  subtitle,
  data,
  metric,
  currency,
}: {
  title: string;
  subtitle?: string;
  data: BreakdownDatum[];
  metric: "spend" | "purchases";
  currency: string;
}) {
  const format = (v: number) =>
    metric === "spend"
      ? currencyFull(v, currency)
      : new Intl.NumberFormat("en-US").format(v);

  // Height scales with number of bars so labels stay readable.
  const height = Math.max(220, data.length * 34 + 24);

  return (
    <Card className='p-6'>
      <div className='mb-1'>
        <h3 className='text-base font-semibold'>{title}</h3>
        {subtitle && (
          <p className='text-xs text-muted-foreground'>{subtitle}</p>
        )}
      </div>
      <div className='mt-4 w-full' style={{ height }}>
        <ResponsiveContainer width='100%' height='100%'>
          <BarChart
            layout='vertical'
            data={data}
            margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray='3 3' horizontal={false} />
            <XAxis
              type='number'
              tickFormatter={(v) =>
                metric === "spend"
                  ? currencyCompact(v, currency)
                  : new Intl.NumberFormat("en-US", {
                      notation: "compact",
                    }).format(v)
              }
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type='category'
              dataKey='name'
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              width={150}
              tickFormatter={(v: string) =>
                v.length > 22 ? `${v.slice(0, 21)}…` : v
              }
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number) => [
                format(v),
                metric === "spend" ? "Spend" : "Purchases",
              ]}
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
            />
            <Bar dataKey='value' radius={[0, 4, 4, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  className={cn(d.isOthers && "opacity-50")}
                  fill='hsl(var(--primary))'
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
