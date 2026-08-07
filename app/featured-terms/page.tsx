import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout, {
  LegalBanner,
  SectionHeading,
} from "@/components/ContentPageLayout";

/**
 * Featured Tier Subscriber Agreement — /featured-terms
 * Source: _handoff/02_mockups_production/07_legal_pages/featured_terms.html
 *
 * Attorney text, transcribed verbatim from the raw file with UTF-8 preserved.
 * See app/privacy/page.tsx for the rule.
 *
 * THE AUTO-RENEWAL BANNER IS A STATUTORY DISCLOSURE, NOT A DESIGN ELEMENT.
 * Fla. Stat. § 501.0605 requires an automatic-renewal offer to present the
 * renewal terms clearly and conspicuously before purchase, and to send an
 * acknowledgment (which § 4.4 promises). Do not move it below the fold, fold it
 * into body copy, or soften the wording.
 *
 * This is the only page carrying a real phone number — (786) 225-5654, from the
 * mockup. The DMCA agent number is still a placeholder; see app/dmca/page.tsx.
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

export const metadata: Metadata = {
  title: "Featured Tier Subscriber Agreement · Florida Contractor Registry",
  description:
    "The agreement governing the $29/month Featured Tier subscription on FloridaContractorRegistry.com.",
  alternates: { canonical: "/featured-terms" },
};

export default function FeaturedTermsPage() {
  return (
    <ContentPageLayout
      slug="/featured-terms"
      kicker="Featured Tier Subscriber Agreement"
      h1Plain="Featured tier"
      h1Em="agreement."
      lede="The agreement governing the $29/month Featured Tier subscription on FloridaContractorRegistry.com."
      readMinutes={7}
      metaLabel="Effective"
      isLegal
    >
      <LegalBanner label="Auto-Renewal Notice">
        This Agreement creates a monthly automatic-renewal subscription. By
        subscribing, you authorize Olga&rsquo;s Friends LLC (or its payment
        processor) to charge your payment method $29 per month, plus any
        applicable taxes, on the same day each month until you cancel. You may
        cancel at any time through your profile dashboard. See Section 4 for full
        cancellation terms.
      </LegalBanner>

      <SectionHeading num={1}>Parties and scope</SectionHeading>
      <p>
        This Featured Tier Subscriber Agreement (the &ldquo;Agreement&rdquo;) is a
        binding agreement between Olga&rsquo;s Friends LLC, a Florida limited
        liability company (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;), and the Florida-licensed contractor or business
        identified during signup (the &ldquo;Subscriber&rdquo;). This Agreement
        governs the Subscriber&rsquo;s subscription to the Featured Tier on
        FloridaContractorRegistry.com (the &ldquo;Site&rdquo;). This Agreement
        supplements (and does not replace) the{" "}
        <Link href="/terms">Terms of Service</Link>,{" "}
        <Link href="/privacy">Privacy Policy</Link>, and other policies of the
        Site, all of which are incorporated by reference. In the event of a
        conflict between this Agreement and the general Terms of Service, this
        Agreement controls with respect to the Featured Tier.
      </p>

      <SectionHeading num={2}>The featured tier</SectionHeading>
      <p>
        The Featured Tier provides Subscriber with the following benefits, as we
        may update from time to time and as described on the subscription page at
        signup:
      </p>
      <ul>
        <li>
          <strong>Enhanced placement</strong> of Subscriber&rsquo;s claimed
          profile in directory search results and category listings
        </li>
        <li>
          <strong>Expanded display options</strong> on the profile, including
          business logo, optional owner photograph, and extended About text
        </li>
        <li>
          <strong>Inclusion in Featured contractor lists</strong> where applicable
        </li>
        <li>
          <strong>Other features</strong> as we may add to the Tier from time to
          time
        </li>
      </ul>
      <p>
        We may modify the specific features included in the Featured Tier in our
        discretion. Material reductions in features will be communicated to
        Subscriber with a reasonable opportunity to cancel before the next
        renewal.
      </p>

      <SectionHeading num={3}>Fee, billing, and payment</SectionHeading>
      <h3>3.1 Fee</h3>
      <p>
        The Featured Tier subscription fee is $29 per month, plus any applicable
        taxes.
      </p>

      <h3>3.2 Billing</h3>
      <p>
        Billing is monthly in advance. Subscriber&rsquo;s first charge occurs at
        signup. Subsequent charges occur on the same day of each subsequent month
        (or the closest valid day if the original billing day does not exist in a
        given month). Payments are processed by Stripe, our third-party payment
        processor.
      </p>

      <h3>3.3 Authorization</h3>
      <p>
        By subscribing, Subscriber authorizes us (and our payment processor) to
        charge the payment method on file for the recurring monthly fee.
        Subscriber represents that the payment method is valid and that Subscriber
        is authorized to use it.
      </p>

      <h3>3.4 Failed payments</h3>
      <p>
        If a payment attempt fails, we may retry the charge up to three times
        within ten days. If all attempts fail, we may suspend Featured Tier
        benefits until payment is current and may terminate the subscription if
        payment remains uncollected after thirty (30) days.
      </p>

      <h3>3.5 Price changes</h3>
      <p>
        We may change the subscription fee for the Featured Tier upon thirty (30)
        days&rsquo; advance notice to Subscriber. Subscriber&rsquo;s continued
        participation in the Featured Tier after the effective date of the new fee
        constitutes acceptance of the new fee. Subscriber may cancel as described
        in Section 4 to avoid the new fee.
      </p>

      <SectionHeading num={4}>Auto-renewal and cancellation</SectionHeading>
      <h3>4.1 Auto-renewal</h3>
      <p>
        <strong>This is a monthly auto-renewing subscription.</strong> The
        subscription will automatically renew each month at the then-current price
        unless and until Subscriber cancels.
      </p>

      <h3>4.2 How to cancel</h3>
      <p>
        Subscriber may cancel at any time through the profile dashboard on the
        Site. Cancellation may also be made by sending written notice to the email
        address in Section 13.
      </p>

      <h3>4.3 Effect of cancellation</h3>
      <p>
        Cancellation takes effect at the end of the current monthly billing
        period. Subscriber retains Featured Tier benefits through the end of the
        period for which payment has already been made.{" "}
        <strong>We do not pro-rate refunds for cancellations</strong> unless
        required by applicable law.
      </p>

      <h3>4.4 Acknowledgment email</h3>
      <p>
        At signup, we will send Subscriber an acknowledgment email confirming the
        subscription, the fee, the billing cycle, the auto-renewal nature, and
        instructions for cancellation.
      </p>

      <SectionHeading num={5}>Subscriber responsibilities</SectionHeading>
      <h3>5.1 License maintenance</h3>
      <p>
        Subscriber represents and warrants that Subscriber is the holder of a
        current Florida contractor license (or an authorized representative of the
        licensed business) and that the license is in active status. Subscriber
        agrees to promptly notify us if Subscriber&rsquo;s license becomes
        suspended, revoked, or expired. We may suspend or terminate the Featured
        Tier subscription if Subscriber&rsquo;s license is not active.
      </p>

      <h3>5.2 Profile accuracy</h3>
      <p>
        Subscriber is responsible for the accuracy of all information added to the
        profile (About text, contact information, website URL, business logo,
        optional owner photograph). Subscriber must maintain accuracy and promptly
        update or remove content that becomes inaccurate.
      </p>

      <h3>5.3 Content licensing</h3>
      <p>
        Subscriber represents and warrants that Subscriber owns or has all rights
        necessary to display any business logo, photograph, or other content
        uploaded to the profile, and grants Olga&rsquo;s Friends LLC a
        non-exclusive, royalty-free, worldwide license to host, display,
        reproduce, modify (for technical purposes such as resizing), and
        distribute the content as part of the Site&rsquo;s directory and related
        marketing communications.
      </p>

      <h3>5.4 Compliance with law</h3>
      <p>
        Subscriber agrees to use the Featured Tier in compliance with applicable
        Florida and federal law, including (without limitation) Florida contractor
        advertising and licensing requirements under Fla. Stat. Ch. 489 and Fla.
        Admin. Code Ch. 61G4, the Florida Deceptive and Unfair Trade Practices Act
        (Fla. Stat. &sect; 501.204), and applicable advertising and
        consumer-protection laws.
      </p>

      <SectionHeading num={6}>Content moderation</SectionHeading>
      <p>
        We may, in our discretion, decline to display, modify, or remove any
        Subscriber-uploaded content that we determine in good faith may:
      </p>
      <ul>
        <li>Violate applicable law</li>
        <li>Infringe the rights of others</li>
        <li>Be false, misleading, defamatory, or harassing</li>
        <li>
          Contain prohibited content (sexually explicit material, content
          depicting violence, or content unrelated to contracting services)
        </li>
        <li>
          Be inconsistent with the editorial standards of the Site as we may
          publish them from time to time
        </li>
      </ul>
      <p>
        Where content is removed, we will notify Subscriber and provide a
        reasonable opportunity to submit replacement content.
      </p>

      <SectionHeading num={7}>Suspension and termination by us</SectionHeading>
      <p>
        We may suspend or terminate the Featured Tier subscription, in our
        discretion, including (without limitation) for: failure to maintain a
        current Florida license, failure to pay, breach of this Agreement, breach
        of the Terms of Service, false statements during signup, content
        moderation violations, fraud or suspected fraud, conduct that may harm
        other users or the integrity of the Site, or compliance with legal
        process. We may, but are not required to, provide advance notice of
        suspension or termination.
      </p>
      <p>
        <strong>
          Termination by us for cause does not entitle Subscriber to any refund.
        </strong>
      </p>

      <SectionHeading num={8}>Termination by subscriber</SectionHeading>
      <p>
        Subscriber may terminate this Agreement at any time by cancelling the
        subscription as described in Section 4. Termination ends Featured Tier
        benefits at the end of the then-current billing period but does not delete
        Subscriber&rsquo;s claimed-profile status or general Site account, which
        continue under the general <Link href="/terms">Terms of Service</Link>.
      </p>

      <SectionHeading num={9}>Disclaimers</SectionHeading>
      <p>
        <strong>
          We do not guarantee any specific outcome from the Featured Tier
        </strong>
        , including number of leads, number of profile views, increase in
        business, or any other commercial result. Featured Tier benefits are
        subject to general Site disclaimers in the{" "}
        <Link href="/terms">Terms of Service</Link>.
      </p>

      <SectionHeading num={10}>Limitation of liability</SectionHeading>
      <p>
        <strong>
          Our aggregate liability under this Agreement, for any and all claims,
          will not exceed the total amount Subscriber has paid us in the twelve
          (12) months preceding the event giving rise to the claim.
        </strong>{" "}
        Other limitation-of-liability provisions in the Terms of Service apply.
      </p>

      <SectionHeading num={11}>Dispute resolution</SectionHeading>
      <p>
        Disputes arising under this Agreement are subject to the dispute
        resolution, arbitration, and class-action waiver provisions in Section 14
        of the <Link href="/terms">Terms of Service</Link>, which are incorporated
        by reference.
      </p>

      <SectionHeading num={12}>General provisions</SectionHeading>
      <p>
        This Agreement, together with the Terms of Service and other incorporated
        documents, is the entire agreement between the parties with respect to the
        Featured Tier. We may update this Agreement on thirty (30) days&rsquo;
        notice; continued participation after the effective date of the update
        constitutes acceptance. Florida law governs. Venue is Broward County,
        Florida. If any provision is unenforceable, the remainder remains in
        effect.
      </p>

      <SectionHeading num={13}>Contact</SectionHeading>
      <div className="border border-gray-200 bg-paper-raised px-6 py-5">
        <dl>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            By Email
          </dt>
          <dd className="mb-4 mt-1">info@floridacontractorregistry.com</dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            By Phone
          </dt>
          <dd className="mb-4 mt-1">(786) 225-5654</dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            By Mail
          </dt>
          <dd className="mt-1">
            Olga&rsquo;s Friends LLC
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
