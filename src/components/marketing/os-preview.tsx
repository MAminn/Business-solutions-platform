import { LoopaMark } from "./loopa-mark";

const rail = ["Overview", "Clients", "Creatives", "Reports"];

// Fixed, meaningless proportions. Purely a shape language for the illustration
// so it reads as an interface — deliberately no axes, values or labels.
const bars = [38, 62, 47, 78, 55, 88, 66, 92];

/**
 * Abstract, non-functional illustration of the Loopa Media Buyer OS, built from
 * the existing design tokens. It contains no client data, no metrics and no
 * numbers of any kind — the shapes are decorative only.
 */
export function OsPreview() {
  return (
    <figure className='m-0'>
      <div
        aria-hidden='true'
        className='overflow-hidden rounded-2xl border border-border bg-card/70 shadow-2xl'>
        {/* Window chrome */}
        <div className='flex items-center gap-3 border-b border-border/70 bg-background/60 px-5 py-3.5'>
          <span className='flex gap-1.5'>
            <span className='h-2.5 w-2.5 rounded-full bg-border' />
            <span className='h-2.5 w-2.5 rounded-full bg-border' />
            <span className='h-2.5 w-2.5 rounded-full bg-border' />
          </span>
          <span className='ml-2 h-2 w-28 rounded-full bg-border/70' />
        </div>

        <div className='flex'>
          {/* Left rail */}
          <div className='hidden w-40 shrink-0 flex-col gap-1.5 border-r border-border/70 bg-background/40 p-4 sm:flex'>
            <div className='mb-4 flex items-center gap-2.5'>
              <LoopaMark className='h-7 w-7 rounded-md' />
              <span className='h-2 w-14 rounded-full bg-border' />
            </div>
            {rail.map((item, i) => (
              <span
                key={item}
                className={
                  i === 0
                    ? "flex items-center gap-2.5 rounded-md bg-secondary px-2.5 py-2"
                    : "flex items-center gap-2.5 rounded-md px-2.5 py-2"
                }>
                <span
                  className={
                    i === 0
                      ? "h-2 w-2 rounded-sm bg-accent"
                      : "h-2 w-2 rounded-sm bg-border"
                  }
                />
                <span
                  className={
                    i === 0
                      ? "h-2 flex-1 rounded-full bg-foreground/40"
                      : "h-2 flex-1 rounded-full bg-border"
                  }
                />
              </span>
            ))}
          </div>

          {/* Content area */}
          <div className='min-w-0 flex-1 space-y-5 p-5 sm:p-6'>
            {/* Summary tiles — empty frames, no values */}
            <div className='grid grid-cols-3 gap-3'>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className='space-y-2.5 rounded-lg border border-border/70 bg-background/50 p-3.5'>
                  <span className='block h-1.5 w-1/2 rounded-full bg-border' />
                  <span className='block h-3 w-3/4 rounded-full bg-foreground/25' />
                </div>
              ))}
            </div>

            {/* Abstract bar shapes */}
            <div className='rounded-lg border border-border/70 bg-background/50 p-4'>
              <span className='mb-4 block h-1.5 w-20 rounded-full bg-border' />
              <div className='flex h-28 items-end gap-2'>
                {bars.map((h, i) => (
                  <span
                    key={i}
                    style={{ height: `${h}%` }}
                    className={
                      i === bars.length - 1
                        ? "flex-1 rounded-t-sm bg-accent/70"
                        : "flex-1 rounded-t-sm bg-primary/50"
                    }
                  />
                ))}
              </div>
            </div>

            {/* Abstract list rows */}
            <div className='space-y-2'>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className='flex items-center gap-3 rounded-lg border border-border/70 bg-background/50 px-3.5 py-3'>
                  <span className='h-6 w-6 shrink-0 rounded-md bg-secondary' />
                  <span className='h-2 flex-1 rounded-full bg-border' />
                  <span className='hidden h-2 w-12 rounded-full bg-border sm:block' />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption className='mt-4 text-center text-xs text-muted-foreground/80'>
        Illustrative representation of the internal platform. No client data is
        shown.
      </figcaption>
    </figure>
  );
}
