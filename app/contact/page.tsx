import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout from "@/components/ContentPageLayout";

/**
 * Contact — /contact
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO FORM, AND THAT IS THE BUILD RATHER THAN AN OMISSION.
 *
 * A contact form needs somewhere for the message to land, and this schema has
 * nowhere honest:
 *
 *   · inquiries requires contractor_dbpr_sync_key NOT NULL — it models a
 *     message TO a specific contractor and cannot hold a general one.
 *   · leads.lead_source is CHECK-constrained to
 *     ('diagnostic_flow','contractor_contact','manual_admin'). A general
 *     enquiry is none of those, and pushing one into the GoHighLevel concierge
 *     pipeline would route a licensing question to someone paid to sell.
 *   · A new contact_messages table needs an admin surface to read it, or it is
 *     a write-only hole that silently swallows mail.
 *
 * And the timing is wrong independently of the schema. There are already three
 * unauthenticated public POSTs with no rate limiting, one of which
 * (app/contractor/[slug]/actions.ts) is a documented LAUNCH BLOCKER because it
 * writes with the service role and delivers spam to contractors as billable
 * leads. Adding a fourth before that closes makes the blocker worse.
 *
 * Meanwhile six addresses are already published across the legal pages and
 * already receive mail. Routing people to the right one is the whole job — it
 * is more useful than a form, because a form that lands in one inbox loses the
 * routing that these addresses encode.
 *
 * REVISIT AFTER RATE LIMITING. A form is then a real option, and it needs its
 * own table, its own admin surface, and a throttle — not a textarea.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ THE ADDRESSES BELOW MUST STAY IN STEP WITH THE LEGAL PAGES. Each one is
 * already named in an attorney-reviewed document — dmca@ in the DMCA agent
 * block, privacy@ in the privacy policy, sms@ in the SMS terms. Changing one
 * here without changing it there publishes two different official contacts for
 * the same obligation. The legal pages are the source of truth.
 *
 * ⚠ AND THEY MUST ACTUALLY DELIVER. admin_settings.html lists the Zoho
 * forwarding for these six as "Setup Pending". If that is still true, this page
 * is a list of addresses that bounce — worse than no page. Verify before the
 * apex domain goes live.
 */

export const metadata: Metadata = {
  // Full suffix, matching every other page — see the note on title in
  // app/layout.tsx for why there is no template doing this.
  title: "Contact · Florida Contractor Registry",
  description:
    "How to reach Florida Contractor Registry — support, corrections, privacy, legal notices and takedown requests.",
  alternates: { canonical: "/contact" },
};

type Route = {
  address: string;
  heading: string;
  body: React.ReactNode;
};

/**
 * Ordered by how often each is genuinely needed, not by importance to us. A
 * homeowner with a question about a listing is the common case and goes first;
 * the statutory addresses are last because almost nobody needs them and the
 * people who do already know the term they are looking for.
 */
const ROUTES: Route[] = [
  {
    address: "support@floridacontractorregistry.com",
    heading: "General questions and corrections",
    body: (
      <>
        Anything about a listing, a search that did not find what you expected,
        or a profile that looks wrong. If you are reporting an error in a
        contractor&rsquo;s record, please include the licence number — it is the
        fastest way for us to find the row.
      </>
    ),
  },
  {
    address: "info@floridacontractorregistry.com",
    heading: "Press, partnerships and everything else",
    body: <>Anything that is not support, legal, or a privacy request.</>,
  },
  {
    address: "privacy@floridacontractorregistry.com",
    heading: "Privacy requests",
    body: (
      <>
        Access, correction and deletion requests under the privacy policy. Note
        the limit set out there: contractor licence records come from a public
        state register and we cannot delete them from that register — see{" "}
        <Link href="/privacy">our privacy policy</Link> for what we can and
        cannot do with public records.
      </>
    ),
  },
  {
    address: "legal@floridacontractorregistry.com",
    heading: "Legal notices",
    body: (
      <>
        Service of process, disputes and anything referencing our{" "}
        <Link href="/terms">terms of service</Link>.
      </>
    ),
  },
  {
    address: "dmca@floridacontractorregistry.com",
    heading: "Copyright takedown",
    body: (
      <>
        Our designated DMCA agent. A notice has to contain specific elements to
        be valid — <Link href="/dmca">the DMCA page</Link> lists them, and a
        notice missing them cannot be acted on.
      </>
    ),
  },
  {
    address: "sms@floridacontractorregistry.com",
    heading: "SMS and messaging",
    body: (
      <>
        Questions about text messages you have received from us, and consent
        withdrawal. See <Link href="/sms-terms">the SMS terms</Link>. You can
        also reply STOP to any message.
      </>
    ),
  },
];

export default function ContactPage() {
  return (
    <ContentPageLayout
      slug="/contact"
      kicker="Get in Touch"
      h1Plain="Contact"
      h1Em="us."
      lede="Six addresses, each going to the person who can actually answer. Pick the one that matches what you need."
      readMinutes={2}
      metaLabel="Page last updated"
    >
      <p>
        There is no contact form on this page, deliberately. Every address below
        is a real mailbox that reaches a person, and choosing the right one gets
        you a faster answer than a single form that funnels everything into one
        queue.
      </p>

      <p>
        We are <strong>Olga&rsquo;s Friends LLC</strong>, trading as Florida
        Contractor Registry.
      </p>

      <h2>Who to write to</h2>

      <dl>
        {ROUTES.map((route) => (
          <div key={route.address}>
            <dt>
              <strong>{route.heading}</strong>
              <br />
              <a href={`mailto:${route.address}`}>{route.address}</a>
            </dt>
            <dd>{route.body}</dd>
          </div>
        ))}
      </dl>

      <h2>What we cannot help with</h2>

      <p>
        <strong>We are not the Florida DBPR.</strong> We republish their public
        licensing data; we do not issue, renew, suspend or reinstate licences,
        and we cannot change what the state register says about you. If a record
        is wrong at the source, it has to be corrected with DBPR — writing to us
        will not reach them. <Link href="/sources">Our data sources page</Link>{" "}
        explains the relationship and links to DBPR directly.
      </p>

      <p>
        <strong>We do not take complaints about contractors.</strong> A complaint
        against a licensee is filed with the state, and there is a specific form
        and process for it. <Link href="/complaint">Our complaint guide</Link>{" "}
        walks through it, including the form number and what to include.
      </p>

      <p>
        <strong>We cannot recommend a contractor</strong> or tell you what a job
        should cost. The registry shows you what the state record says; the
        judgement is yours. <Link href="/hiring-checklist">The hiring checklist</Link>{" "}
        covers what to verify before you sign anything.
      </p>

      <h2>If you are a contractor</h2>

      <p>
        To claim your profile, find yourself in the registry and use the
        &ldquo;Claim this profile&rdquo; link on your own page — claiming
        requires proving the licence is yours, so it cannot be done by email.{" "}
        <Link href="/join">The join page</Link> explains what the
        process asks for.
      </p>

      <p>
        If your profile is already claimed and you need to reach us about it,
        write to <a href="mailto:support@floridacontractorregistry.com">
          support@floridacontractorregistry.com
        </a>{" "}
        from the email address on the account.
      </p>
    </ContentPageLayout>
  );
}
