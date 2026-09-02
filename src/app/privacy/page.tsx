import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalList,
  LegalPage,
  LegalSection,
} from "@/components/marketing/legal-page";

const TITLE = "Privacy Policy | Loopa Growth";
const DESCRIPTION =
  "How Loopa Growth handles business contact information and authorised advertising account data used for campaign monitoring, analysis and reporting.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://loopagrowth.com/privacy" },
  openGraph: {
    type: "website",
    url: "https://loopagrowth.com/privacy",
    siteName: "Loopa Growth",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title='Privacy Policy'
      updated='September 2026'
      intro='This policy explains, in plain language, what information Loopa Growth handles as part of its performance marketing and media buying services, why we handle it, and who can access it.'>
      <LegalSection heading='Who this policy covers'>
        <p>
          Loopa Growth is a performance marketing and media buying agency based
          in Egypt, working with clients across EMEA. This policy applies to
          this website and to the internal Loopa Media Buyer OS used by our team
          to deliver agency services.
        </p>
      </LegalSection>

      <LegalSection heading='Information you give us directly'>
        <p>
          If you contact us about working together, we handle the business and
          contact information you choose to share with us, such as a name,
          company, email address and details of the enquiry. We use it only to
          respond to you and to manage the working relationship.
        </p>
      </LegalSection>

      <LegalSection heading='Authorised advertising account data'>
        <p>
          Where a client explicitly authorises our agency to access their
          advertising accounts, we retrieve advertising data through the
          advertising platform&rsquo;s API. This typically includes campaign, ad
          set, ad and creative records and their associated performance metrics.
        </p>
        <p>
          Access is granted by the client, and the client can revoke it at any
          time through the advertising platform. We retrieve this data for the
          purposes described below and not for unrelated purposes.
        </p>
      </LegalSection>

      <LegalSection heading='Why we use this data'>
        <LegalList
          items={[
            "Campaign monitoring and day-to-day media buying operations",
            "Advertising performance analysis and KPI tracking",
            "Creative performance analysis",
            "Client reporting",
            "Internal operational workflows such as account reviews and follow-up tasks",
          ]}
        />
        <p>
          Advertising data integrations are designed for analytics and
          reporting. Loopa&rsquo;s current workflow does not automatically
          create, pause, edit or change campaign budgets through advertising
          APIs.
        </p>
      </LegalSection>

      <LegalSection heading='Who can access it'>
        <p>
          Access to the Loopa Media Buyer OS is restricted to authenticated,
          authorised users. Team members are granted access according to the
          clients and responsibilities assigned to them. The platform is not
          publicly accessible and there is no public self-service sign-up.
        </p>
      </LegalSection>

      <LegalSection heading='Credentials and access tokens'>
        <p>
          Access credentials and platform tokens used to connect authorised
          advertising accounts are stored by the platform in encrypted form and
          are never displayed publicly or exposed on this website.
        </p>
      </LegalSection>

      <LegalSection heading='We do not sell data'>
        <p>
          Loopa Growth does not sell client data, advertising account data or
          contact information, and does not share it for unrelated third-party
          marketing.
        </p>
      </LegalSection>

      <LegalSection heading='Third-party advertising platforms'>
        <p>
          The advertising platforms we work with operate their own services and
          APIs. Your use of those platforms, and the data held within them,
          remains governed by each platform&rsquo;s own terms and privacy
          policies. This policy covers what Loopa Growth does with data it is
          authorised to access.
        </p>
      </LegalSection>

      <LegalSection heading='Questions'>
        <p>
          For questions about this policy or about data we hold on your
          advertising accounts, contact the Loopa Growth team at{" "}
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
