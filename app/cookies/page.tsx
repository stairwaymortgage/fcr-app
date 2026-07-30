import type { Metadata } from "next";

import ContentPageLayout, {
  SectionHeading,
} from "@/components/ContentPageLayout";

/**
 * Cookie Notice — /cookies
 * Source: _handoff/02_mockups_production/07_legal_pages/cookies.html
 *
 * Attorney text, transcribed verbatim. See app/privacy/page.tsx for the rule:
 * structural edits only (HTML → JSX, straight quotes → typographic entities),
 * never a rewrite.
 *
 * No LegalBanner — this page's mockup opens with a plain paragraph rather than
 * a highlighted callout, unlike privacy and terms.
 */

export const metadata: Metadata = {
  title: "Cookie Notice · Florida Contractor Registry",
  description:
    "What cookies and similar technologies Florida Contractor Registry uses, and what choices you have.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <ContentPageLayout
      slug="/cookies"
      kicker="Cookie Notice"
      h1Plain="Cookie"
      h1Em="notice."
      lede="What cookies and similar technologies we use, and what choices you have."
      readMinutes={3}
      metaLabel="Effective"
      isLegal
    >
      <p>
        This Cookie Notice explains what cookies and similar technologies we use
        on FloridaContractorRegistry.com (the &ldquo;Site&rdquo;) and what choices
        you have.
      </p>

      <SectionHeading num={1}>What cookies are</SectionHeading>
      <p>
        Cookies are small text files that websites place on your device to
        remember information about your visit. Similar technologies (local
        storage, session storage) work in related ways. Together we refer to
        these as &ldquo;cookies&rdquo; for simplicity.
      </p>

      <SectionHeading num={2}>Cookies we use</SectionHeading>
      <p>We use a deliberately limited set of cookies:</p>

      <h3>2.1 Essential cookies</h3>
      <p>
        These cookies are necessary for the Site to function. They cannot be
        disabled in our systems.
      </p>
      <ul>
        <li>
          <strong>Session cookies</strong> &mdash; Maintain your session state if
          you are an authenticated contractor or admin user
        </li>
        <li>
          <strong>Security cookies</strong> &mdash; Protect against cross-site
          request forgery and other security threats
        </li>
        <li>
          <strong>Preference cookies</strong> &mdash; Remember your basic
          preferences (such as sort order on listing pages) between visits
        </li>
      </ul>

      <h3>2.2 Analytics cookies</h3>
      <p>
        We use a privacy-respecting analytics service to understand aggregate
        usage of the Site &mdash; how many people visit, which pages are most
        popular, where visits come from. This data is aggregated and does not
        identify individual visitors.
      </p>

      <h3>2.3 What we do NOT use</h3>
      <p>We do not use:</p>
      <ul>
        <li>Third-party advertising cookies</li>
        <li>Cross-site behavioral tracking</li>
        <li>Social media tracking pixels (Facebook, Google, LinkedIn, etc.)</li>
        <li>Retargeting cookies</li>
        <li>Affiliate marketing tracking cookies</li>
      </ul>

      <SectionHeading num={3}>Your choices</SectionHeading>
      <p>
        Most browsers allow you to control cookies through their settings
        preferences. You can typically block or delete cookies through your
        browser. Blocking essential cookies may prevent parts of the Site from
        working correctly.
      </p>
      <p>
        Because we do not use advertising or behavioral tracking cookies, there is
        no &ldquo;Do Not Track&rdquo; or &ldquo;Sale of Personal
        Information&rdquo; opt-out specifically applicable to our Site.
      </p>

      <SectionHeading num={4}>Changes</SectionHeading>
      <p>
        We may update this Cookie Notice from time to time. Material changes will
        be posted on the Site with the new &ldquo;Last Updated&rdquo; date.
      </p>

      <SectionHeading num={5}>Contact</SectionHeading>
      <p>
        Questions about cookies can be sent to{" "}
        <strong>privacy@floridacontractorregistry.com</strong>.
      </p>
    </ContentPageLayout>
  );
}
