import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

/**
 * Shared shell for the public legal pages (/privacy, /terms).
 * Static content only — no data access of any kind.
 */
export function LegalPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex min-h-screen flex-col bg-background'>
      <SiteHeader />
      <main className='flex-1'>
        <div className='mx-auto w-full max-w-3xl px-5 py-20 sm:px-8 sm:py-24'>
          <p className='flex items-center gap-3 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground'>
            <span aria-hidden='true' className='h-px w-6 bg-accent' />
            Loopa Growth
          </p>
          <h1 className='mt-5 text-3xl font-semibold tracking-tight sm:text-4xl'>
            {title}
          </h1>
          <p className='mt-5 text-base leading-relaxed text-muted-foreground'>
            {intro}
          </p>
          <p className='mt-4 text-sm text-muted-foreground/80'>
            Last updated: {updated}
          </p>
          <div className='mt-14 space-y-12 border-t border-border/60 pt-14'>
            {children}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className='text-lg font-semibold tracking-tight'>{heading}</h2>
      <div className='mt-4 space-y-4 text-base leading-relaxed text-muted-foreground'>
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className='space-y-3'>
      {items.map((item) => (
        <li key={item} className='flex gap-3'>
          <span
            aria-hidden='true'
            className='mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent'
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
