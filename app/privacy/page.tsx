import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout, {
  LegalBanner,
  SectionHeading,
} from "@/components/ContentPageLayout";

/**
 * Privacy Policy — /privacy
 * Source: _handoff/02_mockups_production/07_legal_pages/privacy.html
 *
 * ATTORNEY TEXT, TRANSCRIBED VERBATIM. Every sentence below is copied from the
 * mockup without paraphrase, reordering or "tightening". The only edits are
 * structural — HTML tags become JSX, and `'` / `"` become the typographic
 * entities the rest of the site uses. If a sentence here reads awkwardly, that
 * is the drafting and it stays; changing legal copy is not a build decision.
 *
 * The entity is Olga's Friends LLC throughout, which is what the legal mockups
 * already say. The stale "Florida Contractor Registry LLC" appears only in the
 * older component mockups and was corrected in Footer.tsx before launch.
 */

export const metadata: Metadata = {
  title: "Privacy Policy · Florida Contractor Registry",
  description:
    "How Florida Contractor Registry collects, uses, and protects your information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <ContentPageLayout
      slug="/privacy"
      kicker="Privacy Policy"
      h1Plain="Your"
      h1Em="privacy."
      lede="How we collect, use, and protect your information on FloridaContractorRegistry.com."
      readMinutes={8}
      metaLabel="Effective"
      isLegal
    >
      <LegalBanner label="Important">
        This Privacy Policy explains what information we collect, how we use it,
        who we share it with, and the choices available to you. By using the Site
        or submitting information through any form on the Site, you agree to the
        practices described in this Policy.
      </LegalBanner>

      <SectionHeading num={1}>Who we are</SectionHeading>
      <p>
        FloridaContractorRegistry.com (the &ldquo;Site&rdquo;) is operated by
        Olga&rsquo;s Friends LLC, a Florida limited liability company
        (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). The Site is a
        private commercial directory of Florida-licensed contractors. We are not
        affiliated with, endorsed by, or operated by the State of Florida, the
        Florida Department of Business and Professional Regulation
        (&ldquo;DBPR&rdquo;), the Construction Industry Licensing Board, or any
        government agency.
      </p>

      <SectionHeading num={2}>Information we collect</SectionHeading>
      <p>
        We collect three categories of information through the Site, described
        below.
      </p>

      <h3>2.1 Information about contractors (from public records)</h3>
      <p>
        Contractor profiles on the Site are built from the Florida DBPR&rsquo;s
        weekly public-records extract, made available under Chapter 119, Florida
        Statutes. The fields we republish include license number, license type,
        business name, qualifying agent name, mailing address (city, county, and
        ZIP code), license status, license issuance and expiration dates, and
        disciplinary action codes.
      </p>
      <p>
        We do not collect this information directly from contractors. We
        republish it from public records refreshed weekly. The DBPR record at{" "}
        <a
          href="https://www.myfloridalicense.com"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          myfloridalicense.com
        </a>{" "}
        is the authoritative source and may differ from what we display between
        refreshes.
      </p>

      <h3>2.2 Information you provide directly</h3>
      <h4>(a) Homeowner inquiry form</h4>
      <p>
        When you click an advisory banner and complete our diagnostic flow, we
        collect: (i) your answers to a short series of diagnostic questions about
        your project, property, and financial planning intentions; and (ii) the
        contact information you submit on the final form, which includes your
        name, phone number, email address, ZIP code, and any optional notes you
        provide.
      </p>

      <h4>(b) Contractor profile claim</h4>
      <p>
        If you are a Florida-licensed contractor and you claim a profile on the
        Site, we collect: (i) information you submit to confirm your identity,
        including a photograph of a government-issued identification document;
        (ii) business contact information you choose to display on your profile
        (which may include website, email, phone, and a written
        &ldquo;about&rdquo; description); (iii) optionally, a business logo and an
        owner photograph that you choose to upload to your profile; and (iv)
        optionally, your interest in third-party services offered by partner
        companies.
      </p>

      <h4>(c) Featured contractor subscription</h4>
      <p>
        If you upgrade to a Featured tier subscription, payment information is
        collected directly by our payment processor (Stripe). We do not store
        full payment card details; we receive a payment confirmation and limited
        identifying information from Stripe necessary to associate your
        subscription with your profile.
      </p>

      <h3>2.3 Technical information collected automatically</h3>
      <p>
        When you visit the Site, our hosting and analytics infrastructure
        automatically collects limited technical information necessary to operate
        the Site and understand aggregate usage. This includes IP address,
        browser type, device type, referring URL, pages viewed, and approximate
        geographic location inferred from IP address. We do not use behavioral
        advertising trackers, third-party advertising pixels, or cross-site
        tracking technologies.
      </p>

      <SectionHeading num={3}>How we use information</SectionHeading>
      <p>We use the information described above for the following purposes:</p>
      <ul>
        <li>
          <strong>To operate the Site</strong> &mdash; display contractor
          profiles, allow searching, and present information you have submitted
          (claimed profiles)
        </li>
        <li>
          <strong>To respond to homeowner inquiries</strong> &mdash; route
          inquiries to the appropriate person on our advisory team for follow-up
          by phone, email, or text message
        </li>
        <li>
          <strong>To verify contractor identity</strong> &mdash; confirm that a
          person claiming a profile is the actual licensee or qualifying agent
          for that profile
        </li>
        <li>
          <strong>To process subscriptions</strong> &mdash; administer Featured
          tier subscriptions, billing, and renewals through our payment processor
        </li>
        <li>
          <strong>To improve the Site</strong> &mdash; analyze aggregate usage to
          identify and fix technical issues and improve user experience
        </li>
        <li>
          <strong>To comply with legal obligations</strong> &mdash; respond to
          lawful requests, enforce our Terms of Service, and protect against
          fraud or unauthorized use
        </li>
      </ul>

      <SectionHeading num={4}>Who receives your information</SectionHeading>
      <p>
        We share information with the following categories of recipients, only as
        necessary to operate the Site and serve you:
      </p>

      <h3>4.1 Our advisory team</h3>
      <p>
        If you submit an inquiry through the Site, your contact information and
        diagnostic answers are received by a member of our advisory team. This
        team consists of licensed Florida professionals (including, but not
        limited to, licensed mortgage loan originators, real estate agents, and
        business lending professionals). The advisory team contacts you to discuss
        your situation and, where appropriate, introduces you to{" "}
        <strong>
          a licensed Florida professional, which may include companies affiliated
          with us
        </strong>
        . Any introduction to a settlement-service provider for a
        real-estate-secured transaction is accompanied by required affiliated
        business arrangement disclosures at the time of the introduction.
      </p>

      <h3>4.2 The contractor whose profile you contacted</h3>
      <p>
        If you submit an inquiry through the &ldquo;contact this
        contractor&rdquo; form on a specific contractor&rsquo;s profile page, your
        inquiry is forwarded to that contractor. We do not sell or syndicate this
        contact information to other contractors.
      </p>

      <h3>4.3 Service providers</h3>
      <p>
        We use third-party service providers to operate the Site, including:
      </p>
      <ul>
        <li>
          <strong>Hosting and infrastructure</strong> &mdash; Vercel (hosting),
          Cloudflare (DNS and CDN), Supabase (database)
        </li>
        <li>
          <strong>Customer relationship management and communication</strong>{" "}
          &mdash; GoHighLevel (which uses Twilio for SMS delivery)
        </li>
        <li>
          <strong>Payment processing</strong> &mdash; Stripe
        </li>
        <li>
          <strong>Analytics</strong> &mdash; A privacy-respecting, non-behavioral
          analytics provider
        </li>
      </ul>
      <p>
        These service providers have access only to the information necessary to
        perform their function and are contractually obligated to protect it.
      </p>

      <h3>4.4 Legal compliance</h3>
      <p>
        We may disclose information if required by law, subpoena, court order, or
        other legal process; to enforce our Terms of Service; to investigate
        suspected fraud or unauthorized access; or to protect the rights,
        property, or safety of any person.
      </p>

      <h3>4.5 What we do NOT do</h3>
      <p>
        We do not sell your personal information. We do not share homeowner
        contact information with other contractors. We do not allow third parties
        to place behavioral advertising trackers on the Site. We do not use
        information collected for purposes other than those described in this
        Policy without your consent.
      </p>

      <SectionHeading num={5}>How long we keep information</SectionHeading>
      <ul>
        <li>
          <strong>Homeowner inquiry data</strong> &mdash; retained for up to 24
          months from your last interaction with our advisory team, then deleted
          unless retention is required by law
        </li>
        <li>
          <strong>Contractor profile data</strong> &mdash; retained while your
          license appears on the DBPR public extract; claimed-profile information
          you add is retained as long as your profile is active
        </li>
        <li>
          <strong>Government identification images</strong> &mdash; retained for
          90 days after claim approval or rejection, then deleted
        </li>
        <li>
          <strong>Subscription and payment records</strong> &mdash; retained for 7
          years for tax and accounting purposes
        </li>
        <li>
          <strong>Technical logs</strong> &mdash; retained for 12 months
        </li>
      </ul>

      <SectionHeading num={6}>How we protect information</SectionHeading>
      <p>
        We use industry-standard security measures to protect information against
        unauthorized access, alteration, disclosure, or destruction. These include
        encryption in transit (HTTPS), encryption at rest for sensitive data
        (including government identification images), access controls limiting
        employee access to information to those with a legitimate business need,
        and regular security reviews.
      </p>
      <p>
        No system is completely secure, and we cannot guarantee absolute security.
        If we discover a security incident affecting your information, we will
        notify you as required by applicable law.
      </p>

      <SectionHeading num={7}>Your choices and rights</SectionHeading>
      <h3>7.1 SMS opt-out</h3>
      <p>
        You may stop receiving text messages from us at any time by replying STOP
        to any message. Reply HELP for assistance. See our{" "}
        <Link href="/sms-terms">SMS Terms</Link> for full details.
      </p>

      <h3>7.2 Email opt-out</h3>
      <p>
        You may unsubscribe from non-essential email by clicking the unsubscribe
        link in any message we send. We will continue to send transactional
        messages necessary to provide services you have requested (for example,
        billing confirmations for Featured tier subscribers).
      </p>

      <h3>7.3 Access, correction, deletion</h3>
      <p>
        You may request a copy of the personal information we hold about you, ask
        us to correct inaccurate information, or ask us to delete information we
        hold. We will respond to requests within 30 days. Requests can be made by
        emailing the address in Section 12.
      </p>
      <p>
        Some information cannot be deleted on request &mdash; for example,
        contractor public-records data sourced from DBPR cannot be removed from
        the Site while the underlying license is active, and some information must
        be retained to comply with legal obligations.
      </p>

      <h3>7.4 California, Virginia, and other state-specific rights</h3>
      <p>
        If you are a resident of California, Virginia, Colorado, Connecticut, or
        another state with comprehensive privacy laws, you may have additional
        rights, including the right to opt out of &ldquo;sales&rdquo; or
        &ldquo;sharing&rdquo; of personal information for cross-context behavioral
        advertising.{" "}
        <strong>
          We do not sell personal information and we do not share personal
          information for cross-context behavioral advertising
        </strong>
        , so this right has no current application to our practices. If you
        believe a request applies to you, contact us at the address in Section 12.
      </p>

      <SectionHeading num={8}>Children</SectionHeading>
      <p>
        The Site is not directed to children under 18 and we do not knowingly
        collect information from anyone under 18. If we learn that we have
        collected information from a child under 18, we will delete it promptly.
      </p>

      <SectionHeading num={9}>Cookies and tracking technologies</SectionHeading>
      <p>
        We use a limited set of cookies and similar technologies for essential
        Site functionality and aggregate analytics. We do not use third-party
        advertising cookies. See our <Link href="/cookies">Cookie Notice</Link>{" "}
        for details.
      </p>

      <SectionHeading num={10}>Third-party links</SectionHeading>
      <p>
        The Site may contain links to third-party websites (for example, links to
        the DBPR licensing portal, a contractor&rsquo;s own website, or a city or
        county building department). We are not responsible for the privacy
        practices of those sites. We encourage you to read their privacy policies.
      </p>

      <SectionHeading num={11}>Changes to this policy</SectionHeading>
      <p>
        We may update this Privacy Policy from time to time. When we do, we will
        update the &ldquo;Last Updated&rdquo; date at the top of this page and,
        for material changes, post prominent notice on the Site for 30 days.
        Continued use of the Site after a change constitutes acceptance of the
        updated Policy.
      </p>

      <SectionHeading num={12}>Contact</SectionHeading>
      <p>
        Questions about this Privacy Policy or about our handling of your
        information can be sent to:
      </p>
      <div className="border border-gray-200 bg-paper-raised px-6 py-5">
        <dl>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            By Email
          </dt>
          <dd className="mb-4 mt-1">privacy@floridacontractorregistry.com</dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            By Mail
          </dt>
          <dd className="mt-1">
            Olga&rsquo;s Friends LLC
            <br />
            Attn: Privacy
            <br />
            1520 E Sunrise Blvd
            <br />
            Fort Lauderdale, FL 33304
          </dd>
        </dl>
      </div>
    </ContentPageLayout>
  );
}
