import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout, {
  LegalBanner,
  SectionHeading,
} from "@/components/ContentPageLayout";
import { publicPageMetadata } from "@/lib/seo";

/**
 * Terms of Service — /terms
 * Source: _handoff/02_mockups_production/07_legal_pages/terms.html
 *
 * ATTORNEY TEXT, TRANSCRIBED VERBATIM. Read from the raw file with UTF-8
 * preserved, not from a re-encoded extract — an earlier pass mangled §, — and ·
 * into replacement characters, and a mangled section symbol in a statutory
 * citation is a real defect.
 *
 * THE ALL-CAPS IN SECTIONS 11 AND 12 IS LOAD-BEARING, NOT SHOUTING. UCC
 * § 2-316 and its Florida analogue require warranty disclaimers to be
 * "conspicuous", and capitalisation is the conventional way that is satisfied.
 * Do not sentence-case it to look tidier; that is a substantive change to a
 * disclaimer's enforceability, not a styling preference.
 *
 * Section 14 (arbitration + class waiver) and Section 16 (Florida venue) are
 * the provisions the opening banner is required to surface. If the banner is
 * ever edited, the section numbers it cites must still match.
 */

/**
 * ⚠ REQUIRED, NOT DECORATION. Without it this page is FULLY static and its
 * "Data as of …" line — rendered by Header and Footer via dataAsOf() — is baked
 * in at build time and never updates again, including after a weekly DBPR
 * import.
 *
 * That became possible on 2026-08-07: dataAsOf() stopped reading cookies (see
 * lib/supabase/public.ts), which was the only thing keeping these content pages
 * dynamic. They went static as a side effect and would have frozen the date
 * permanently. lib/data-as-of.ts predicted exactly this failure in its docblock.
 *
 * 86400 matches the listing routes: DBPR publishes weekly, so a day is well
 * inside the window in which the date can actually change.
 */
export const revalidate = 86400;

export const metadata: Metadata = publicPageMetadata({
  title: "Terms of Service · Florida Contractor Registry",
  description:
    "The agreement between you and Olga's Friends LLC governing your use of FloridaContractorRegistry.com — permitted use, content, public records data and DMCA.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <ContentPageLayout
      slug="/terms"
      kicker="Terms of Service"
      h1Plain="Terms of"
      h1Em="service."
      lede="The agreement between you and Olga's Friends LLC governing your use of FloridaContractorRegistry.com."
      readMinutes={10}
      metaLabel="Effective"
      isLegal
    >
      <LegalBanner label="Please Read Carefully">
        These Terms of Service include important provisions affecting your legal
        rights, including binding individual arbitration with a class-action
        waiver (Section 14), a limitation of liability (Section 12), and a Florida
        choice of law and venue (Section 16). By using the Site, you agree to
        these Terms.
      </LegalBanner>

      <SectionHeading num={1}>Acceptance of terms</SectionHeading>
      <p>
        These Terms of Service (these &ldquo;Terms&rdquo;) govern your use of
        FloridaContractorRegistry.com (the &ldquo;Site&rdquo;), operated by
        Olga&rsquo;s Friends LLC (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;). By accessing or using the Site, you agree to be bound
        by these Terms and by our <Link href="/privacy">Privacy Policy</Link>. If
        you do not agree to these Terms, do not use the Site.
      </p>

      <SectionHeading num={2}>
        What the site is &mdash; and what it is not
      </SectionHeading>
      <p>
        The Site is a private commercial directory of Florida contractor
        licenses. We aggregate publicly available licensing data from the Florida
        Department of Business and Professional Regulation (&ldquo;DBPR&rdquo;)
        and display it in a more accessible format. We also operate an advisory
        service that connects homeowners with licensed Florida professionals for
        discussions about the financial side of contracting projects.
      </p>
      <p>
        The Site is <strong>not</strong>:
      </p>
      <ul>
        <li>A government website or service</li>
        <li>
          Affiliated with, endorsed by, or operated by the State of Florida, DBPR,
          the Construction Industry Licensing Board, or any government agency
        </li>
        <li>
          A licensing authority (we do not issue, suspend, or revoke contractor
          licenses)
        </li>
        <li>
          A regulator (we do not investigate complaints &mdash; that is
          DBPR&rsquo;s function)
        </li>
        <li>
          An endorsement service (we do not vouch for the quality, reliability, or
          character of any contractor)
        </li>
        <li>
          A real-time license verification system (data is refreshed weekly; the
          authoritative real-time source is{" "}
          <a
            href="https://www.myfloridalicense.com"
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            myfloridalicense.com
          </a>
          )
        </li>
        <li>
          A lead-broker service (we do not sell homeowner contact information to
          multiple contractors)
        </li>
      </ul>

      <SectionHeading num={3}>The homeowner inquiry service</SectionHeading>
      <p>
        If you submit an inquiry through our advisory banner or diagnostic flow,
        you understand and agree that:
      </p>
      <ul>
        <li>
          Your inquiry will be received by a member of our advisory team, who will
          contact you by phone, email, or text message to discuss your situation
        </li>
        <li>
          You may, in the course of that conversation, be introduced to a licensed
          Florida professional, which may include companies affiliated with us
        </li>
        <li>
          You are under no obligation to engage with anyone you are introduced to,
          and our advisory service is provided at no cost
        </li>
        <li>
          Any subsequent transaction with a licensed professional (such as a
          mortgage application, real estate engagement, or business loan) will be
          governed by that professional&rsquo;s separate documents and
          disclosures, not by these Terms
        </li>
      </ul>

      <SectionHeading num={4}>
        Contractor profile claim and featured subscription
      </SectionHeading>
      <p>
        If you are a Florida-licensed contractor and claim a profile on the Site:
      </p>
      <ul>
        <li>
          You represent that you are the named licensee, the qualifying agent for
          the licensed business, or authorized by them to claim and manage the
          profile
        </li>
        <li>
          You agree to provide accurate identifying information and to update it
          promptly if it changes
        </li>
        <li>
          You retain ownership of any content you upload (logos, photos, text);
          you grant us a non-exclusive license to display that content on the Site
          for as long as your profile remains claimed
        </li>
        <li>
          You agree not to upload content that infringes the rights of others,
          violates law, or is misleading about the nature of your business
        </li>
      </ul>
      <p>
        If you subscribe to the Featured tier ($29/month), additional terms apply
        &mdash; see our{" "}
        <Link href="/featured-terms">Featured Tier Subscriber Agreement</Link> for
        full details on billing, cancellation, and refund policy.
      </p>

      <SectionHeading num={5}>Acceptable use</SectionHeading>
      <p>When using the Site, you agree NOT to:</p>
      <ul>
        <li>
          Scrape, crawl, or systematically download data from the Site (use the
          underlying DBPR public extract directly if you need bulk data)
        </li>
        <li>Submit fraudulent profile claims or inquiries</li>
        <li>
          Impersonate a contractor, licensee, or qualifying agent you are not
          authorized to represent
        </li>
        <li>Use the Site to harass, defame, or threaten any person</li>
        <li>Upload malicious code or attempt to compromise Site security</li>
        <li>
          Reverse engineer or attempt to extract source code from the Site
        </li>
        <li>
          Use automated tools to interact with the Site beyond ordinary browsing
        </li>
        <li>
          Resell, sublicense, or commercially redistribute Site content without
          our written permission
        </li>
      </ul>
      <p>
        Violation of acceptable use may result in suspension or termination of
        your access, removal of any claimed profile, and (in cases of fraud or
        illegal activity) referral to law enforcement.
      </p>

      <SectionHeading num={6}>Intellectual property</SectionHeading>
      <h3>6.1 Our content</h3>
      <p>
        The design, layout, original text, code, organization, and aesthetic of
        the Site are protected by copyright, trademark, and other intellectual
        property laws. You may not reproduce, modify, distribute, or create
        derivative works of the Site without our written permission, except as
        expressly permitted by these Terms or by law.
      </p>

      <h3>6.2 Public records data</h3>
      <p>
        Contractor licensing data displayed on the Site is sourced from DBPR
        public records under Chapter 119, Florida Statutes. That underlying data
        is not subject to copyright. Our presentation, organization, and editorial
        additions to that data are protected by copyright.
      </p>

      <h3>6.3 Contractor-uploaded content</h3>
      <p>
        Logos, photos, and written content uploaded by claiming contractors remain
        the property of the contractor. By uploading, you grant us a
        non-exclusive, royalty-free license to display the content on the Site for
        the duration of your claim.
      </p>

      <h3>6.4 DMCA</h3>
      <p>
        If you believe content on the Site infringes your copyright, see our{" "}
        <Link href="/dmca">DMCA Notice and Takedown Procedure</Link>.
      </p>

      <SectionHeading num={7}>
        Contractor corrections and removal requests
      </SectionHeading>
      <p>
        If you are a contractor whose profile contains an error, you may request a
        correction. We will correct factual errors that don&rsquo;t match the
        underlying DBPR record within one business day of verifying the request.
      </p>
      <p>
        We will <strong>not</strong> remove a profile, qualifying agent name, or
        license information while the underlying license is active on the DBPR
        public extract. The information is in the public record under Florida law.
        Removing it from our Site would not remove it from the state&rsquo;s
        record or from anyone else who publishes the same data.
      </p>

      <SectionHeading num={8}>Privacy</SectionHeading>
      <p>
        Your use of the Site is also governed by our{" "}
        <Link href="/privacy">Privacy Policy</Link>, which is incorporated into
        these Terms by reference.
      </p>

      <SectionHeading num={9}>SMS communications</SectionHeading>
      <p>
        If you opt in to receive text messages in the course of submitting an
        inquiry, additional terms apply. See our{" "}
        <Link href="/sms-terms">SMS Terms</Link>.
      </p>

      <SectionHeading num={10}>Third-party services and links</SectionHeading>
      <p>
        The Site may link to third-party websites or services. We are not
        responsible for the content, accuracy, or practices of third-party sites.
        Your use of third-party sites is governed by their own terms.
      </p>

      <SectionHeading num={11}>Disclaimers</SectionHeading>
      <p>
        THE SITE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo;
        WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. TO THE FULLEST EXTENT
        PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES INCLUDING MERCHANTABILITY,
        FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
      </p>
      <p>WITHOUT LIMITING THE FOREGOING, WE DO NOT WARRANT THAT:</p>
      <ul>
        <li>
          License data displayed on the Site is current as of the moment you view
          it (data is refreshed weekly; some records may be up to seven days
          stale)
        </li>
        <li>
          Any contractor displayed on the Site is qualified, available, insured,
          or willing to perform any specific work
        </li>
        <li>
          The Site will be uninterrupted, error-free, or secure against
          unauthorized access
        </li>
        <li>
          Inquiries submitted through the Site will result in any particular
          outcome
        </li>
      </ul>
      <p>
        <strong>
          For authoritative license verification, always consult{" "}
          <a
            href="https://www.myfloridalicense.com"
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            myfloridalicense.com
          </a>{" "}
          directly.
        </strong>
      </p>

      <SectionHeading num={12}>Limitation of liability</SectionHeading>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY TO YOU FOR ANY
        CLAIM ARISING FROM OR RELATING TO THE SITE OR THESE TERMS IS LIMITED TO
        THE GREATER OF (A) $100, OR (B) THE TOTAL AMOUNT YOU HAVE PAID US IN THE
        12 MONTHS PRECEDING THE CLAIM.
      </p>
      <p>
        IN NO EVENT WILL WE BE LIABLE FOR INDIRECT, CONSEQUENTIAL, INCIDENTAL,
        SPECIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST DATA, OR
        BUSINESS INTERRUPTION, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF
        SUCH DAMAGES.
      </p>

      <SectionHeading num={13}>Indemnification</SectionHeading>
      <p>
        You agree to indemnify and hold us harmless from claims arising from your
        violation of these Terms, your misuse of the Site, or your infringement of
        any third party&rsquo;s rights through the Site.
      </p>

      <SectionHeading num={14}>
        Dispute resolution; arbitration; class waiver
      </SectionHeading>
      <p>
        <strong>Please read this section carefully.</strong> It affects how
        disputes between you and us are resolved.
      </p>
      <p>
        <strong>14.1 Informal resolution first.</strong> Before filing any claim,
        you agree to first contact us at the address in Section 19 and give us 60
        days to attempt to resolve the dispute informally.
      </p>
      <p>
        <strong>14.2 Binding individual arbitration.</strong> Any dispute that
        cannot be resolved informally will be resolved by binding individual
        arbitration administered by the American Arbitration Association under its
        Consumer Arbitration Rules, except as provided below. Arbitration will be
        conducted in Broward County, Florida, or virtually if both parties agree.
      </p>
      <p>
        <strong>14.3 Class action waiver.</strong> You and we agree that disputes
        will be resolved on an individual basis only. You and we waive the right
        to participate in a class action, collective action, or representative
        proceeding.
      </p>
      <p>
        <strong>14.4 Exceptions.</strong> Either party may bring a claim in small
        claims court if it qualifies for that court&rsquo;s jurisdiction. Either
        party may seek injunctive relief in court to prevent ongoing harm.
      </p>
      <p>
        <strong>14.5 Opt-out.</strong> You may opt out of this arbitration
        provision by sending written notice to the address in Section 19 within 30
        days of first agreeing to these Terms. Opt-out notice must include your
        full name, address, and a clear statement that you wish to opt out of
        arbitration.
      </p>

      <SectionHeading num={15}>Termination</SectionHeading>
      <p>
        We may suspend or terminate your access to the Site at any time, with or
        without cause. You may stop using the Site at any time. Sections that by
        their nature should survive termination will survive.
      </p>

      <SectionHeading num={16}>Governing law and venue</SectionHeading>
      <p>
        These Terms are governed by the laws of the State of Florida, without
        regard to conflict-of-law principles. Any dispute not subject to
        arbitration will be brought exclusively in the state or federal courts
        located in Broward County, Florida, and you consent to personal
        jurisdiction in those courts.
      </p>

      <SectionHeading num={17}>Changes to these terms</SectionHeading>
      <p>
        We may update these Terms from time to time. Material changes will be
        posted on the Site with the new &ldquo;Last Updated&rdquo; date and (for
        substantial changes) prominent notice for 30 days. Continued use after a
        change constitutes acceptance.
      </p>

      <SectionHeading num={18}>General provisions</SectionHeading>
      <ul>
        <li>
          <strong>Entire agreement.</strong> These Terms, together with the
          Privacy Policy and any other agreements referenced here, are the entire
          agreement between you and us regarding the Site
        </li>
        <li>
          <strong>Severability.</strong> If any provision is held unenforceable,
          the remaining provisions remain in full force
        </li>
        <li>
          <strong>No waiver.</strong> Our failure to enforce a provision is not a
          waiver of our right to enforce it later
        </li>
        <li>
          <strong>Assignment.</strong> You may not assign these Terms without our
          written consent. We may assign these Terms in connection with a merger,
          sale, or transfer of business
        </li>
        <li>
          <strong>Headings.</strong> Section headings are for convenience only and
          do not affect interpretation
        </li>
      </ul>

      <SectionHeading num={19}>Contact</SectionHeading>
      <p>Questions about these Terms can be sent to:</p>
      <div className="border border-gray-200 bg-paper-raised px-6 py-5">
        <dl>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            By Email
          </dt>
          <dd className="mb-4 mt-1">legal@floridacontractorregistry.com</dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            By Mail
          </dt>
          <dd className="mt-1">
            Olga&rsquo;s Friends LLC
            <br />
            Attn: Legal
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
