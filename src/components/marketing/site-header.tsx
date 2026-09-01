import Link from "next/link";
import { Menu } from "lucide-react";
import { LoopaMark } from "./loopa-mark";

export const marketingNav = [
  { href: "/#services", label: "Services" },
  { href: "/#how-we-work", label: "How We Work" },
  { href: "/#technology", label: "Technology" },
  { href: "/#about", label: "About" },
  { href: "/#contact", label: "Contact" },
];

export function SiteHeader() {
  return (
    <header className='relative z-50 border-b border-border/60 bg-background/85 backdrop-blur lg:sticky lg:top-0 supports-[backdrop-filter]:bg-background/70'>
      <div className='mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5 sm:px-8 lg:h-20'>
        <Link
          href='/'
          className='flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background'>
          <LoopaMark />
          <span className='flex flex-col leading-tight'>
            <span className='text-sm font-semibold tracking-tight'>
              Loopa Growth
            </span>
            <span className='text-[11px] text-muted-foreground'>
              Performance Marketing
            </span>
          </span>
        </Link>

        <nav aria-label='Primary' className='hidden lg:block'>
          <ul className='flex items-center gap-9'>
            {marketingNav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className='text-sm text-muted-foreground transition-colors hover:text-foreground'>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className='flex items-center gap-4 sm:gap-6'>
          <Link
            href='/sign-in'
            className='hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block'>
            Team login
          </Link>
          <Link
            href='/#contact'
            className='hidden rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 sm:inline-block'>
            Work with Loopa
          </Link>

          {/* Mobile menu: pure HTML disclosure, no client JS. The header is
              static (not sticky) below md, so an open panel scrolls away with
              it once a section link is followed. */}
          <details className='lg:hidden'>
            <summary
              aria-label='Open navigation menu'
              className='flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md border border-border text-foreground [&::-webkit-details-marker]:hidden'>
              <Menu aria-hidden='true' className='h-5 w-5' />
            </summary>
            <nav
              aria-label='Mobile'
              className='absolute left-0 right-0 top-full border-b border-border bg-background px-5 pb-6 pt-2 shadow-2xl sm:px-8'>
              <ul className='divide-y divide-border/60'>
                {marketingNav.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className='block py-4 text-base text-foreground'>
                      {item.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    href='/sign-in'
                    className='block py-4 text-base text-muted-foreground'>
                    Team login
                  </Link>
                </li>
              </ul>
              <Link
                href='/#contact'
                className='mt-5 block rounded-md bg-accent px-4 py-3.5 text-center text-sm font-semibold text-accent-foreground sm:hidden'>
                Work with Loopa
              </Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
