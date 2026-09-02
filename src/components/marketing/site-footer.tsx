import Link from "next/link";
import { LoopaMark } from "./loopa-mark";
import { marketingNav } from "./site-header";

export function SiteFooter() {
  return (
    <footer className='border-t border-border/60 bg-card/30'>
      <div className='mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20'>
        <div className='flex flex-col gap-12 md:flex-row md:items-start md:justify-between md:gap-16'>
          <div className='max-w-sm'>
            <div className='flex items-center gap-3'>
              <LoopaMark />
              <span className='text-sm font-semibold tracking-tight'>
                Loopa Growth
              </span>
            </div>
            <p className='mt-5 text-base leading-relaxed text-muted-foreground'>
              Performance marketing and media buying for e-commerce and
              digital-first brands. Based in Egypt, working with clients across
              EMEA.
            </p>
            <p className='mt-5 text-sm text-muted-foreground'>
              <a
                href='mailto:Muhamedhassan@loopagrowth.com'
                className='font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent'>
                Muhamedhassan@loopagrowth.com
              </a>
            </p>
          </div>

          <div className='grid grid-cols-2 gap-10 sm:gap-20'>
            <div>
              <h2 className='text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground'>
                Company
              </h2>
              <ul className='mt-5 space-y-3.5'>
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
            </div>
            <div>
              <h2 className='text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground'>
                Legal &amp; access
              </h2>
              <ul className='mt-5 space-y-3.5'>
                <li>
                  <Link
                    href='/privacy'
                    className='text-sm text-muted-foreground transition-colors hover:text-foreground'>
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link
                    href='/terms'
                    className='text-sm text-muted-foreground transition-colors hover:text-foreground'>
                    Terms of Use
                  </Link>
                </li>
                <li>
                  <Link
                    href='/#data-access'
                    className='text-sm text-muted-foreground transition-colors hover:text-foreground'>
                    Data &amp; platform access
                  </Link>
                </li>
                <li>
                  <Link
                    href='/sign-in'
                    className='text-sm text-muted-foreground transition-colors hover:text-foreground'>
                    Team login
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className='mt-14 flex flex-col gap-2 border-t border-border/60 pt-7 text-xs text-muted-foreground/80 sm:flex-row sm:items-center sm:justify-between'>
          <p>&copy; Loopa Growth. All rights reserved.</p>
          <p>
            Performance marketing &amp; media buying &middot; Egypt &middot;
            EMEA
          </p>
        </div>
      </div>
    </footer>
  );
}
