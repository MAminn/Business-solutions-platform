/**
 * Decorative "loop" motif behind the hero: concentric rings plus a soft
 * Loop Blue bloom. Pure CSS/SVG, no client JS, no image assets.
 */
export function LoopBackdrop() {
  return (
    <div aria-hidden='true' className='pointer-events-none absolute inset-0 overflow-hidden'>
      <div className='absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]' />
      <div className='absolute -top-24 right-[12%] h-72 w-72 rounded-full bg-accent/10 blur-[120px]' />
      <svg
        className='absolute left-1/2 top-[-18rem] h-[52rem] w-[52rem] -translate-x-1/2 text-foreground/[0.07]'
        viewBox='0 0 800 800'
        fill='none'>
        <circle cx='400' cy='400' r='180' stroke='currentColor' strokeWidth='1' />
        <circle cx='400' cy='400' r='260' stroke='currentColor' strokeWidth='1' />
        <circle cx='400' cy='400' r='340' stroke='currentColor' strokeWidth='1' />
        <circle cx='400' cy='400' r='398' stroke='currentColor' strokeWidth='1' />
      </svg>
      <div className='absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background' />
    </div>
  );
}
