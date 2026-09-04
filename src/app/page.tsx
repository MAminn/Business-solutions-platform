import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { LoopBackdrop } from "@/components/marketing/loop-backdrop";
import { OsPreview } from "@/components/marketing/os-preview";

const SITE_URL = "https://loopagrowth.com";

const TITLE = "Loopa Growth | Performance Marketing & Media Buying";
const DESCRIPTION =
  "Loopa Growth is an Egypt-based performance marketing and media buying agency helping e-commerce brands manage, measure and improve paid advertising across EMEA.";

const CONTACT = { email: "Muhamedhassan@loopagrowth.com" as string | null };

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Loopa Growth",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Loopa Growth",
  alternateName: "Loopa",
  url: SITE_URL,
  description: DESCRIPTION,
  address: {
    "@type": "PostalAddress",
    addressCountry: "EG",
  },
  areaServed: [
    { "@type": "Country", name: "Egypt" },
    { "@type": "Place", name: "Europe, Middle East and Africa (EMEA)" },
  ],
  knowsAbout: [
    "Performance marketing",
    "Media buying",
    "Paid social advertising",
    "Advertising performance measurement",
    "Creative performance analysis",
  ],
};

const disciplines = [
  "Paid Social & Media Buying",
  "Performance Measurement",
  "Creative Performance Analysis",
  "Campaign Operations",
];

const clientValue = [
  {
    title: "Clearer decisions",
    body: "Know what is working, what is wasting spend and what needs attention.",
  },
  {
    title: "Faster optimisation",
    body: "Campaign and creative performance are reviewed through structured daily workflows rather than scattered dashboards.",
  },
  {
    title: "Creative learning",
    body: "Turn ad performance into clear creative insights that inform what to test next.",
  },
  {
    title: "Better visibility",
    body: "Understand spend, performance, priorities and account health without waiting for fragmented reports.",
  },
];

const services = [
  {
    index: "01",
    title: "Paid Social & Media Buying",
    value:
      "Strategy, execution and continuous optimisation focused on profitable customer acquisition.",
    capabilities: [
      "Campaign architecture",
      "Budget allocation",
      "Daily optimisation",
      "Scaling decisions",
      "Performance monitoring",
    ],
  },
  {
    index: "02",
    title: "Performance Measurement",
    value:
      "Know where your media spend is going and what it is producing.",
    capabilities: [
      "KPI monitoring",
      "ROAS / CPA analysis",
      "Spend pacing",
      "Period comparison",
      "Client reporting",
    ],
  },
  {
    index: "03",
    title: "Creative Performance Analysis",
    value: "Understand which creative ideas actually drive performance.",
    capabilities: [
      "Winner identification",
      "Fatigue monitoring",
      "Hook / engagement analysis",
      "Creative comparisons",
      "Testing opportunities",
    ],
  },
  {
    index: "04",
    title: "Campaign Operations",
    value:
      "Consistent account management without important actions falling through the cracks.",
    capabilities: [
      "Daily account reviews",
      "Prioritised tasks",
      "Performance flags",
      "Structured workflows",
      "Client-level reporting",
    ],
  },
];

const howWeWork = [
  {
    index: "01",
    stage: "Understand",
    body: "Business economics, targets, products, historical performance and growth constraints.",
  },
  {
    index: "02",
    stage: "Build",
    body: "Campaign structure, measurement framework and creative testing priorities.",
  },
  {
    index: "03",
    stage: "Operate",
    body: "Daily monitoring, optimisation, budget decisions and creative performance review.",
  },
  {
    index: "04",
    stage: "Learn & scale",
    body: "Turn performance data into decisions about what to scale, stop, improve or test next.",
  },
];

const osBenefits = [
  "Faster visibility across account performance",
  "Structured daily account monitoring",
  "Creative performance intelligence",
  "Consistent reporting",
  "Clearer priorities for the media-buying team",
  "Less manual reporting and fragmented decision-making",
];

const whyLoopa = [
  {
    title: "Performance-first",
    body: "Decisions are tied to commercial outcomes, not vanity metrics.",
  },
  {
    title: "Operator-built",
    body: "Our internal tools were built around the workflows media buyers actually use.",
  },
  {
    title: "Creative + media together",
    body: "Creative performance and media performance are analysed as one system.",
  },
  {
    title: "Structured operations",
    body: "Daily monitoring, priorities and reporting follow repeatable processes rather than ad-hoc checks.",
  },
  {
    title: "Visibility",
    body: "Clients get clearer visibility into what is happening and why decisions are being made.",
  },
];

const aboutFacts = [
  { label: "Type", value: "Performance marketing and media buying agency" },
  { label: "Based in", value: "Egypt" },
  { label: "Client region", value: "EMEA" },
  { label: "Focus", value: "E-commerce and digital-first businesses" },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className='flex items-center gap-3 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground'>
      <span aria-hidden='true' className='h-px w-6 bg-accent' />
      {children}
    </p>
  );
}

export default function HomePage() {
  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <div className='flex min-h-screen flex-col bg-background'>
        <SiteHeader />
        <main id='main' className='flex-1'>
          {/* ======================================================= Hero */}
          <section className='relative isolate overflow-hidden'>
            <LoopBackdrop />
            <div className='relative mx-auto w-full max-w-6xl px-5 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28 lg:pb-40 lg:pt-32'>
              <p className='inline-flex items-center gap-2.5 rounded-full border border-border bg-card/70 px-4 py-2 text-xs text-muted-foreground sm:text-sm'>
                <span
                  aria-hidden='true'
                  className='h-1.5 w-1.5 rounded-full bg-accent'
                />
                Performance marketing agency &middot; Egypt &middot; EMEA
              </p>

              <h1 className='mt-8 max-w-4xl text-[2.5rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl'>
                Performance marketing built for{" "}
                <span className='underline decoration-accent decoration-[3px] underline-offset-[10px] sm:decoration-4 sm:underline-offset-[14px]'>
                  profitable growth.
                </span>
              </h1>

              <p className='mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed'>
                Loopa Growth is a performance marketing agency helping
                e-commerce brands turn paid media into measurable, profitable
                growth. We combine hands-on media buying, creative performance
                analysis and our proprietary Media Buyer OS to make faster,
                better-informed decisions.
              </p>

              <div className='mt-11 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4'>
                <Link
                  href='#contact'
                  className='inline-flex items-center justify-center gap-2 rounded-md bg-accent px-7 py-4 text-base font-semibold text-accent-foreground transition-opacity hover:opacity-90'>
                  Work with Loopa
                  <ArrowRight aria-hidden='true' className='h-4 w-4' />
                </Link>
                <Link
                  href='#how-we-work'
                  className='inline-flex items-center justify-center gap-2 rounded-md border border-border px-7 py-4 text-base font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-card/60'>
                  See how we work
                </Link>
              </div>

              <ul className='mt-20 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4'>
                {disciplines.map((item) => (
                  <li key={item} className='border-t border-border pt-4'>
                    <span className='text-sm font-medium text-foreground'>
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* =============================================== Client value */}
          <section
            aria-labelledby='value-heading'
            className='border-t border-border/60 bg-card/20'>
            <div className='mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32 lg:py-40'>
              <div className='max-w-3xl'>
                <Eyebrow>What clients get</Eyebrow>
                <h2
                  id='value-heading'
                  className='mt-7 text-4xl font-semibold tracking-tight sm:text-5xl'>
                  More than media buying.
                </h2>
                <p className='mt-7 text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed'>
                  We build the operating system around your paid growth:
                  strategy, execution, measurement, creative learning and
                  continuous decision-making.
                </p>
              </div>

              <div className='mt-20 grid gap-x-14 gap-y-14 sm:grid-cols-2'>
                {clientValue.map((pillar) => (
                  <div key={pillar.title} className='border-t border-border pt-7'>
                    <h3 className='text-xl font-semibold tracking-tight sm:text-2xl'>
                      {pillar.title}
                    </h3>
                    <p className='mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg sm:leading-relaxed'>
                      {pillar.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* =================================================== Services */}
          <section
            id='services'
            aria-labelledby='services-heading'
            className='scroll-mt-16 border-t border-border/60 lg:scroll-mt-28'>
            <div className='mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32 lg:py-40'>
              <div className='max-w-3xl'>
                <Eyebrow>Services</Eyebrow>
                <h2
                  id='services-heading'
                  className='mt-7 text-4xl font-semibold tracking-tight sm:text-5xl'>
                  What we do for you
                </h2>
                <p className='mt-7 text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed'>
                  We act as the paid media team for the brands we work with,
                  from campaign strategy through to measurement, creative
                  analysis and reporting.
                </p>
              </div>

              <div className='mt-20 space-y-16 sm:space-y-20'>
                {services.map((service) => (
                  <article
                    key={service.index}
                    className='grid gap-6 border-t border-border pt-9 md:grid-cols-12 md:gap-12'>
                    <div className='md:col-span-4'>
                      <span
                        aria-hidden='true'
                        className='block text-sm font-semibold tabular-nums text-accent'>
                        {service.index}
                      </span>
                      <h3 className='mt-3 text-2xl font-semibold tracking-tight sm:text-3xl'>
                        {service.title}
                      </h3>
                    </div>
                    <div className='md:col-span-8'>
                      <p className='max-w-2xl text-lg leading-relaxed text-foreground/90 sm:text-xl sm:leading-relaxed'>
                        {service.value}
                      </p>
                      <ul className='mt-7 flex flex-wrap gap-2.5'>
                        {service.capabilities.map((capability) => (
                          <li
                            key={capability}
                            className='rounded-full bg-secondary px-4 py-2 text-sm text-muted-foreground'>
                            {capability}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* ================================================ How we work */}
          <section
            id='how-we-work'
            aria-labelledby='how-heading'
            className='scroll-mt-16 border-t border-border/60 bg-card/20 lg:scroll-mt-28'>
            <div className='mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32 lg:py-40'>
              <div className='max-w-3xl'>
                <Eyebrow>How we work</Eyebrow>
                <h2
                  id='how-heading'
                  className='mt-7 text-4xl font-semibold tracking-tight sm:text-5xl'>
                  An operating partner, not a dashboard
                </h2>
                <p className='mt-7 text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed'>
                  We stay close to the account every week. Here is what working
                  with Loopa Growth actually looks like.
                </p>
              </div>

              <ol className='mt-20 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4'>
                {howWeWork.map((stage) => (
                  <li key={stage.index} className='border-t border-border pt-7'>
                    <span
                      aria-hidden='true'
                      className='block text-4xl font-semibold tabular-nums text-accent sm:text-5xl'>
                      {stage.index}
                    </span>
                    <h3 className='mt-5 text-xl font-semibold tracking-tight'>
                      {stage.stage}
                    </h3>
                    <p className='mt-3.5 text-base leading-relaxed text-muted-foreground'>
                      {stage.body}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ================================================= Technology */}
          <section
            id='technology'
            aria-labelledby='technology-heading'
            className='scroll-mt-16 border-t border-border/60 lg:scroll-mt-28'>
            <div className='mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32 lg:py-40'>
              <div className='grid items-start gap-16 lg:grid-cols-12 lg:gap-20'>
                <div className='lg:col-span-6'>
                  <Eyebrow>Loopa Media Buyer OS</Eyebrow>
                  <h2
                    id='technology-heading'
                    className='mt-7 text-4xl font-semibold tracking-tight sm:text-5xl'>
                    Built to make better media-buying decisions.
                  </h2>
                  <p className='mt-7 text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed'>
                    We built Loopa Media Buyer OS because managing multiple
                    performance accounts through scattered dashboards,
                    spreadsheets and reporting tools creates blind spots. Our
                    internal platform brings account performance, creative
                    intelligence, reporting and operational priorities into one
                    workflow.
                  </p>

                  <ul className='mt-10 grid gap-x-8 gap-y-4 sm:grid-cols-2'>
                    {osBenefits.map((benefit) => (
                      <li
                        key={benefit}
                        className='flex gap-3 text-base leading-relaxed text-muted-foreground'>
                        <span
                          aria-hidden='true'
                          className='mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent'
                        />
                        {benefit}
                      </li>
                    ))}
                  </ul>

                  <p className='mt-10 border-l-2 border-border pl-6 text-base leading-relaxed text-muted-foreground'>
                    The Media Buyer OS is internal software used by the Loopa
                    Growth team as part of delivering our agency service. It is
                    not currently offered as a public self-service product.
                  </p>
                </div>

                <div className='lg:col-span-6'>
                  <OsPreview />
                </div>
              </div>
            </div>
          </section>

          {/* ================================================== Why Loopa */}
          <section
            aria-labelledby='why-heading'
            className='border-t border-border/60 bg-card/20'>
            <div className='mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32 lg:py-40'>
              <div className='max-w-3xl'>
                <Eyebrow>Why Loopa</Eyebrow>
                <h2
                  id='why-heading'
                  className='mt-7 text-4xl font-semibold tracking-tight sm:text-5xl'>
                  How we are different
                </h2>
              </div>

              <div className='mt-20 grid gap-x-14 gap-y-12 sm:grid-cols-2 lg:grid-cols-3'>
                {whyLoopa.map((item) => (
                  <div key={item.title} className='border-t border-border pt-7'>
                    <h3 className='text-xl font-semibold tracking-tight'>
                      {item.title}
                    </h3>
                    <p className='mt-3.5 text-base leading-relaxed text-muted-foreground sm:text-lg sm:leading-relaxed'>
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ====================================================== About */}
          <section
            id='about'
            aria-labelledby='about-heading'
            className='scroll-mt-16 border-t border-border/60 lg:scroll-mt-28'>
            <div className='mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32 lg:py-40'>
              <div className='grid gap-16 lg:grid-cols-12 lg:gap-20'>
                <div className='lg:col-span-7'>
                  <Eyebrow>About</Eyebrow>
                  <h2
                    id='about-heading'
                    className='mt-7 text-4xl font-semibold tracking-tight sm:text-5xl'>
                    Built for brands that take paid growth seriously.
                  </h2>
                  <div className='mt-8 space-y-6 text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed'>
                    <p>
                      Loopa Growth is an Egypt-based performance marketing and
                      media buying agency serving e-commerce and digital-first
                      brands across EMEA.
                    </p>
                    <p>
                      We combine hands-on media buying, performance measurement,
                      creative analysis and internal technology to help brands
                      operate paid acquisition with more clarity and discipline.
                    </p>
                  </div>
                </div>

                <div className='lg:col-span-5'>
                  <dl className='divide-y divide-border border-t border-border'>
                    {aboutFacts.map((fact) => (
                      <div key={fact.label} className='py-6'>
                        <dt className='text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground'>
                          {fact.label}
                        </dt>
                        <dd className='mt-2.5 text-lg font-medium text-foreground'>
                          {fact.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>
          </section>

          {/* ==================================== Data & platform access */}
          <section
            id='data-access'
            aria-labelledby='data-access-heading'
            className='scroll-mt-16 border-t border-border/60 bg-card/20 lg:scroll-mt-28'>
            <div className='mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32'>
              <div className='max-w-3xl'>
                <Eyebrow>Data &amp; platform access</Eyebrow>
                <h2
                  id='data-access-heading'
                  className='mt-7 text-3xl font-semibold tracking-tight sm:text-4xl'>
                  How we use advertising platform APIs
                </h2>
              </div>

              <div className='mt-14 grid gap-10 lg:grid-cols-2 lg:gap-16'>
                <div className='border-t border-border pt-8'>
                  <h3 className='text-lg font-semibold tracking-tight'>
                    Authorised accounts only
                  </h3>
                  <p className='mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg sm:leading-relaxed'>
                    Loopa Growth uses advertising platform APIs to access data
                    from advertising accounts that have explicitly authorised
                    our agency. This data is used for campaign monitoring,
                    performance analysis, creative analysis, reporting and
                    internal media-buying operations.
                  </p>
                </div>

                <div className='border-t border-border pt-8'>
                  <h3 className='text-lg font-semibold tracking-tight'>
                    Analytics and reporting oriented
                  </h3>
                  <p className='mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg sm:leading-relaxed'>
                    Advertising data integrations are designed for analytics and
                    reporting. Loopa&rsquo;s current workflow does not
                    automatically create, pause, edit or change campaign budgets
                    through advertising APIs.
                  </p>
                </div>
              </div>

              <ul className='mt-12 grid gap-x-12 gap-y-5 md:grid-cols-3'>
                <li className='flex gap-3 text-base leading-relaxed text-muted-foreground'>
                  <span
                    aria-hidden='true'
                    className='mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent'
                  />
                  Access is granted by the client and can be revoked by the
                  client at any time.
                </li>
                <li className='flex gap-3 text-base leading-relaxed text-muted-foreground'>
                  <span
                    aria-hidden='true'
                    className='mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent'
                  />
                  Retrieved data is limited to what is needed for campaign
                  monitoring and reporting.
                </li>
                <li className='flex gap-3 text-base leading-relaxed text-muted-foreground'>
                  <span
                    aria-hidden='true'
                    className='mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent'
                  />
                  Access is restricted to authorised Loopa Growth team members.
                </li>
              </ul>

              <p className='mt-12 text-base leading-relaxed text-muted-foreground'>
                For further detail on what we collect and why, see our{" "}
                <Link
                  href='/privacy'
                  className='font-medium text-foreground underline decoration-accent decoration-2 underline-offset-4'>
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </section>

          {/* ==================================================== Contact */}
          <section
            id='contact'
            aria-labelledby='contact-heading'
            className='scroll-mt-16 border-t border-border/60 lg:scroll-mt-28'>
            <div className='mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32 lg:py-40'>
              <div className='max-w-3xl'>
                <Eyebrow>Contact</Eyebrow>
                <h2
                  id='contact-heading'
                  className='mt-7 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl'>
                  Looking for a better way to run paid growth?
                </h2>
                <p className='mt-7 text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed'>
                  If you are an e-commerce brand looking for a performance
                  marketing partner, we would like to understand your business,
                  targets and current advertising setup.
                </p>

                {CONTACT.email ? (
                  <div className='mt-11'>
                    <Link
                      href={`mailto:${CONTACT.email}`}
                      className='inline-flex items-center justify-center gap-2 rounded-md bg-accent px-7 py-4 text-base font-semibold text-accent-foreground transition-opacity hover:opacity-90'>
                      Talk to Loopa Growth
                      <ArrowRight aria-hidden='true' className='h-4 w-4' />
                    </Link>
                  </div>
                ) : (
                  <p className='mt-11 border-l-2 border-accent pl-6 text-lg leading-relaxed text-foreground/90'>
                    To talk to Loopa Growth about your account, contact our team
                    through your existing agency contact.
                  </p>
                )}

                <p className='mt-14 border-t border-border pt-7 text-sm text-muted-foreground'>
                  Loopa Growth team member?{" "}
                  <Link
                    href='/dashboard'
                    className='font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent'>
                    Sign in to the Media Buyer OS
                  </Link>
                  .
                </p>
              </div>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
