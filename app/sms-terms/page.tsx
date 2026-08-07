import type { Metadata } from "next";
import Link from "next/link";

import { SMS_CONSENT_TEXT } from "@/lib/consent";
import ContentPageLayout, {
  LegalBanner,
  SectionHeading,
} from "@/components/ContentPageLayout";

/**
 * SMS Terms — /sms-terms
 * Source: _handoff/02_mockups_production/07_legal_pages/sms_terms.html
 *
 * Attorney text, transcribed verbatim. See app/privacy/page.tsx for the rule.
 *
 * SECTION 3 IS THE MOST SENSITIVE TEXT ON THE SITE. It reproduces the TCPA
 * consent language shown on the inquiry form, and the Build Brief requires that
 * the verbatim string shown at the time of consent be stored with each
 * submission (leads.sms_consent_text). If the wording here and the wording on
 * the form ever diverge, the stored record no longer matches what the visitor
 * agreed to — which is the whole evidentiary point of storing it. Change one
 * only by changing both, and only on the attorney's instruction.
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
  title: "SMS Terms · Florida Contractor Registry",
  description:
    "Terms governing text messages from the Florida Contractor Registry advisory team, including how to opt out.",
  alternates: { canonical: "/sms-terms" },
};

export default function SmsTermsPage() {
  return (
    <ContentPageLayout
      slug="/sms-terms"
      kicker="SMS Terms"
      h1Plain="SMS"
      h1Em="terms."
      lede="Terms governing text messages you receive from our advisory team after submitting an inquiry."
      readMinutes={4}
      metaLabel="Effective"
      isLegal
    >
      <LegalBanner label="Quick Summary">
        We use text messages to follow up on inquiries you submit through this
        site. You opt in by checking the consent box on the inquiry form. You can
        opt out at any time by replying STOP. Message and data rates may apply.
      </LegalBanner>

      <SectionHeading num={1}>Program description</SectionHeading>
      <p>
        Olga&rsquo;s Friends LLC (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;) operates a text-message communication program (the
        &ldquo;Program&rdquo;) used to contact individuals who have submitted an
        inquiry through the homeowner inquiry form on
        FloridaContractorRegistry.com (the &ldquo;Site&rdquo;). The Program is
        used by our advisory team to follow up on inquiries, share information
        about your situation, schedule conversations, and (where appropriate)
        introduce you to a licensed Florida professional.
      </p>

      <SectionHeading num={2}>Consent to receive messages</SectionHeading>
      <p>
        You opt in to receive text messages from us by affirmatively checking the
        consent checkbox on our homeowner inquiry form and submitting the form.
        Your consent is voluntary and is not a condition of receiving advisory
        services, which can also be conducted entirely by phone or email at your
        preference.
      </p>

      <SectionHeading num={3}>Verbatim consent language</SectionHeading>
      <p>The consent language that appears on the inquiry form is:</p>
      {/*
        Rendered from the SMS_CONSENT_TEXT constant, not retyped. The same
        constant is the checkbox label on the diagnostic capture form and the
        value written to leads.sms_consent_text. Publishing a retyped copy here
        would let this page drift from what visitors actually agreed to, which
        is precisely what makes the stored record worthless as evidence.
      */}
      <div className="border-l-4 border-l-gold bg-gray-50 px-6 py-5">
        <p className="mb-0">&ldquo;{SMS_CONSENT_TEXT}&rdquo;</p>
      </div>

      <SectionHeading num={4}>Message frequency</SectionHeading>
      <p>
        Message frequency varies based on the nature of your inquiry and the stage
        of follow-up. Most inquirers receive between 2 and 10 messages over a
        30-day period, with occasional follow-ups beyond that. You can opt out at
        any time.
      </p>

      <SectionHeading num={5}>Carrier disclosures</SectionHeading>
      <p>
        Message and data rates may apply. Carriers are not liable for delayed or
        undelivered messages. We support all major U.S. carriers, including
        AT&amp;T, Verizon, T-Mobile, and their affiliates. Carrier availability and
        message delivery are subject to your carrier&rsquo;s coverage and service.
      </p>

      <SectionHeading num={6}>How to opt out</SectionHeading>
      <p>
        You may opt out of receiving text messages at any time by replying{" "}
        <strong>STOP</strong> to any message we send. After we receive your
        opt-out, we will send one final confirmation message, and you will not
        receive further text messages from this Program.
      </p>
      <p>
        Opting out of text messages does not opt you out of email or phone
        follow-up. To stop email communications, use the unsubscribe link in any
        of our emails. To stop phone calls, ask the person calling to stop and
        they will note your request.
      </p>

      <SectionHeading num={7}>How to get help</SectionHeading>
      <p>
        Reply <strong>HELP</strong> to any message we send for assistance. You
        will receive a reply with our contact information and a link back to these
        SMS Terms.
      </p>

      <SectionHeading num={8}>Privacy</SectionHeading>
      <p>
        Information collected through the Program is handled in accordance with
        our <Link href="/privacy">Privacy Policy</Link>. Your phone number is not
        shared with third parties for marketing purposes.
      </p>

      <SectionHeading num={9}>Changes</SectionHeading>
      <p>
        We may update these SMS Terms from time to time. The version in effect at
        the time you receive a message governs that message. Material changes will
        be posted on the Site with the new &ldquo;Last Updated&rdquo; date.
      </p>

      <SectionHeading num={10}>Contact</SectionHeading>
      <p>Questions about the Program can be sent to:</p>
      <div className="border border-gray-200 bg-paper-raised px-6 py-5">
        <dl>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            By Email
          </dt>
          <dd className="mb-4 mt-1">sms@floridacontractorregistry.com</dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            By Mail
          </dt>
          <dd className="mt-1">
            Olga&rsquo;s Friends LLC
            <br />
            Attn: SMS Compliance
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
