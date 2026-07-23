"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";

interface ChartPoint {
  date: string; // ISO
  spend: number;
}

/** Compact axis/tooltip formatter. Uses the passed currency when present;
 * falls back to a symbol-less compact number for mixed/unknown currencies. */
function formatSpend(value: number, currency: string | null): string {
  if (currency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
    } catch {
      // fall through to symbol-less
    }
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function SpendRoasChart({
  data,
  currency = null,
  title = "Spend & ROAS — last 30 days",
  subtitle = "Aggregated across all clients",
}: {
  data: ChartPoint[];
  currency?: string | null;
  title?: string;
  subtitle?: string;
}) {
  return (
    <Card className='p-6'>
      <div className='mb-1 flex items-start justify-between'>
        <div>
          <h3 className='text-base font-semibold'>{title}</h3>
          <p className='text-xs text-muted-foreground'>{subtitle}</p>
        </div>
      </div>
      <div className='mt-4 h-[280px] w-full'>
        <ResponsiveContainer width='100%' height='100%'>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id='spendGradient' x1='0' y1='0' x2='0' y2='1'>
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
              dataKey='date'
              tickFormatter={(v) => format(new Date(v), "MMM d")}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(v) => formatSpend(v as number, currency)}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(v) =>
                format(new Date(v as string), "MMM d, yyyy")
              }
              formatter={(v: number) => {
                if (currency) {
                  try {
                    return [
                      new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency,
                        maximumFractionDigits: 0,
                      }).format(v),
                      "Spend",
                    ];
                  } catch {
                    // fall through to symbol-less
                  }
                }
                return [v.toLocaleString(), "Spend"];
              }}
            />
            <Area
              type='monotone'
              dataKey='spend'
              stroke='hsl(var(--primary))'
              strokeWidth={2}
              fill='url(#spendGradient)'
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
