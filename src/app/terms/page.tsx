import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/marketing/legal-page";

const TITLE = "Terms of Use | Loopa Growth";
const DESCRIPTION =
  "Terms covering the use of the Loopa Growth website and access to the internal Loopa Media Buyer OS.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://loopagrowth.com/terms" },
  openGraph: {
    type: "website",
    url: "https://loopagrowth.com/terms",
    siteName: "Loopa Growth",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
};

export default function TermsPage() {
  return (
    <LegalPage
      title='Terms of Use'
      updated='September 2026'
      intro='These terms cover the use of this website and access to the internal Loopa Media Buyer OS.'>
      <LegalSection heading='This website'>
        <p>
          This website describes Loopa Growth, a performance marketing and media
          buying agency, and the services it provides. The content is provided
          for general information about our business and may be updated or
          changed at any time.
        </p>
      </LegalSection>

      <LegalSection heading='The Loopa Media Buyer OS'>
        <p>
          The Loopa Media Buyer OS is internal software used by the Loopa Growth
          team to deliver its agency services. It is not offered for public
          sale, and there is no public self-service sign-up.
        </p>
        <p>
          Access is limited to authorised users. If you have been given access,
          you are responsible for keeping your credentials confidential, for
          using the platform only for its intended purpose, and for not sharing
          access with anyone who has not been authorised.
        </p>
      </LegalSection>

      <LegalSection heading='Advertising platforms'>
        <p>
          Loopa Growth accesses advertising account data only where a client has
          explicitly authorised our agency to do so. Those advertising platforms
          are operated by third parties, and their services, APIs and data
          remain governed by each platform&rsquo;s own terms.
        </p>
      </LegalSection>

      <LegalSection heading='Client engagements'>
        <p>
          Nothing on this website forms an offer or a contract. Any engagement
          between Loopa Growth and a client is governed by the separate written
          agreement made between us for that engagement.
        </p>
      </LegalSection>

      <LegalSection heading='No warranty on website content'>
        <p>
          We take care to keep the information on this website accurate, but it
          is provided as-is and without warranty. Advertising results depend on
          many factors outside our control, and nothing described here is a
          guarantee of any particular outcome.
        </p>
      </LegalSection>

      <LegalSection heading='Contact'>
        <p>
          For questions about these terms, contact the Loopa Growth team at{" "}
          <Link
            href='mailto:Muhamedhassan@loopagrowth.com'
            className='font-medium text-foreground underline decoration-accent decoration-2 underline-offset-4'>
            Muhamedhassan@loopagrowth.com
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
