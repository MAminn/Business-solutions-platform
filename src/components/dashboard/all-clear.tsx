import { Card } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";

export function AllClear() {
  return (
    <Card className='flex items-center gap-3 p-4'>
      <span className='flex h-8 w-8 items-center justify-center rounded-full bg-success/15'>
        <CheckCircle2 className='h-4 w-4 text-emerald-400' />
      </span>
      <div>
        <p className='text-sm font-medium'>All clear</p>
        <p className='text-xs text-muted-foreground'>
          No clients need attention right now.
        </p>
      </div>
    </Card>
  );
}
