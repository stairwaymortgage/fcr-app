import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout from "@/components/ContentPageLayout";
import { contractorCountLabel } from "@/lib/registry-stats";

/**
 * For Contractors — /contractors  (PLACEHOLDER)
 *
 * THE ROUTE IS /contractors, NOT /for-contractors. Header.tsx:37 and four
 * Footer entries already point here, as does the homepage CTA strip and the
 * claim box on every profile — so this path is fixed by what already ships, not
 * chosen. Renaming it would create the dead links it exists to remove.
 *
 * A HOLDING PAGE, DELIBERATELY THIN. The real page is
 * _handoff/02_mockups_production/04_contractor_facing/for_contractors.html, and
 * it depends on the claim flow, auth and Stripe — Week 5 and Week 6. Building
 * the full mockup now would promise a signup that cannot complete.
 *
 * What it replaces: a 404 on the single highest-intent link on the site. A
 * contractor who clicks "Claim Your Profile" is the exact person the Featured
 * tier depends on, and sending them to a not-found page is worse than sending
 * them to an honest "not yet".
 *
 * NO EMAIL CAPTURE. There is nowhere to put it — the leads table is for
 * homeowner diagnostic submissions and its schema does not fit a contractor
 * waitlist. Inventing a table for a placeholder would be worse than asking
 * people to come back.
 */

export const metadata: Metadata = {
  title: "For contractors · Florida Contractor Registry",
  description:
    "Claim your Florida contractor profile, free. Contractor features are coming soon to Florida Contractor Registry.",
  alternates: { canonical: "/contractors" },
  // Nothing here is worth ranking yet, and indexing a placeholder would compete
  // with the real page when it ships. follow, so the links still pass through.
  robots: { index: false, follow: true },
};

export default function ForContractorsPage() {
  return (
    <ContentPageLayout
      slug="/contractors"
      kicker="For Contractors"
      h1Plain="Your profile is already here."
      h1Em="Claiming opens soon."
      lede={`All ${contractorCountLabel()} contractor records on this site are built from public DBPR data — including yours. Claiming lets you take control of what homeowners see.`}
      readMinutes={1}
      metaLabel="Page last updated"
    >
      <h2>What claiming will do</h2>
      <p>
        Every contractor record on this site is republished from the Florida DBPR
        weekly public-records extract. You did not create your profile and you do
        not need to do anything for it to appear. Claiming it means verifying that
        you are the licensee or qualifying agent, and then controlling the parts
        of the page that are not public record.
      </p>
      <ul>
        <li>
          <strong>Verify your identity once</strong> &mdash; confirm you are the
          licensee or qualifying agent for the profile
        </li>
        <li>
          <strong>Add what the public record cannot say</strong> &mdash; a
          description of your work, your logo, a photograph, your website and
          direct contact details
        </li>
        <li>
          <strong>Receive inquiries</strong> &mdash; homeowners who contact you
          through your profile reach you directly
        </li>
        <li>
          <strong>Correct what looks wrong</strong> &mdash; licence data itself
          comes from DBPR and has to be corrected there, but everything around it
          becomes yours
        </li>
      </ul>

      <h2>What it costs</h2>
      <p>
        Claiming a profile is free and always will be. A separate optional
        Featured tier will place claimed profiles at the top of county and city
        listings for a monthly subscription; that is the only paid product on the
        site, and nothing about your licence data changes whether you pay or not.
      </p>

      <h2>When</h2>
      <p>
        Identity verification and the claim flow are being built now. This page
        will become the real one when they are ready. There is no waiting list to
        join &mdash; your profile is already live and searchable, and claiming it
        later costs you nothing in the meantime.
      </p>

      <h2>In the meantime</h2>
      <p>
        Find your profile and check that the public record we republish is
        accurate. If the DBPR data itself is wrong &mdash; a licence status, an
        expiration date, an address &mdash; that has to be corrected with DBPR,
        because we republish their extract rather than maintain our own copy.
      </p>
      <p>
        <Link href="/search">Search for your business or licence number</Link>, or
        browse <Link href="/counties">by county</Link> and{" "}
        <Link href="/types">by licence type</Link>.
      </p>
    </ContentPageLayout>
  );
}
