"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { BreakdownRow, AnalysisLevel } from "@/server/analysis";

type SortField =
  | "name"
  | "purchases"
  | "spend"
  | "cpa"
  | "roas"
  | "conversionValue";
type SortOrder = "asc" | "desc";

const LEVEL_LABEL: Record<AnalysisLevel, string> = {
  ACCOUNT: "Account",
  CAMPAIGN: "Campaign",
  AD: "Ad",
};

function currencyFull(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function int(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

interface ColumnDef {
  field: SortField;
  label: string;
  align: "left" | "right";
}

export function TopEntitiesTable({
  rows,
  currency,
  level,
}: {
  rows: BreakdownRow[];
  currency: string;
  level: AnalysisLevel;
}) {
  const [sort, setSort] = useState<SortField>("purchases");
  const [order, setOrder] = useState<SortOrder>("desc");

  const columns: ColumnDef[] = [
    { field: "name", label: `${LEVEL_LABEL[level]} name`, align: "left" },
    { field: "purchases", label: "Purchases", align: "right" },
    { field: "spend", label: "Spend", align: "right" },
    { field: "cpa", label: "Meta CPA", align: "right" },
    { field: "roas", label: "Meta ROAS", align: "right" },
    { field: "conversionValue", label: "Conversion value", align: "right" },
  ];

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp: number;
      if (sort === "name") {
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      } else {
        cmp = a[sort] - b[sort];
      }
      if (cmp === 0) cmp = b.purchases - a.purchases;
      return order === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [rows, sort, order]);

  function toggle(field: SortField) {
    if (sort === field) {
      setOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSort(field);
      setOrder(field === "name" ? "asc" : "desc");
    }
  }

  return (
    <div className='rounded-xl border border-border/60 bg-card'>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => {
              const isActive = sort === col.field;
              return (
                <TableHead
                  key={col.field}
                  className={col.align === "right" ? "text-right" : undefined}>
                  <button
                    type='button'
                    onClick={() => toggle(col.field)}
                    className={cn(
                      "inline-flex items-center gap-1 hover:text-foreground",
                      col.align === "right" && "justify-end",
                      isActive && "text-foreground",
                    )}>
                    {col.label}
                    {isActive ? (
                      order === "desc" ? (
                        <ChevronDown className='h-3.5 w-3.5' />
                      ) : (
                        <ChevronUp className='h-3.5 w-3.5' />
                      )
                    ) : (
                      <ChevronsUpDown className='h-3.5 w-3.5 opacity-40' />
                    )}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.id}>
              <TableCell className='max-w-[280px] truncate font-medium'>
                {r.name}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {int(r.purchases)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {currencyFull(r.spend, currency)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {r.purchases > 0 ? currencyFull(r.cpa, currency) : "—"}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {r.spend > 0 ? `${r.roas.toFixed(2)}x` : "—"}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {currencyFull(r.conversionValue, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
