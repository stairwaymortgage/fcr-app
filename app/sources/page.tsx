import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout from "@/components/ContentPageLayout";
import { contractorCountLabel } from "@/lib/registry-stats";
import { publicPageMetadata } from "@/lib/seo";

/**
 * Data Sources — /sources
 * Source: _handoff/02_mockups_production/06_content_pages/sources.html
 *
 * SAME CORRECTION AS /about. The mockup's source table says "266,312 active
 * records"; both the figure and "active" were corrected sitewide on 2026-07-30.
 * It renders CONTRACTOR_COUNT and says "records". On the page whose entire
 * purpose is being transparent about the data, publishing a stale count would
 * be self-defeating.
 *
 * The rest is the mockup's copy as written.
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
  title: "Data sources · Florida Contractor Registry",
  description:
    "Where Florida Contractor Registry's data comes from, how often it updates, what the weekly DBPR public records extract includes, and what it leaves out.",
  path: "/sources",
});

export default function SourcesPage() {
  return (
    <ContentPageLayout
      slug="/sources"
      kicker="Where the Data Comes From"
      h1Plain="Data"
      h1Em="sources."
      lede="We believe a public registry should be transparent about where its data comes from. This page tells you exactly that."
      readMinutes={3}
      metaLabel="Page last updated"
    >
      <p>
        We believe a public registry should be transparent about where its data
        comes from, how often it&rsquo;s updated, what&rsquo;s included, and
        what&rsquo;s not. This page lays out exactly that.
      </p>

      <h2>Primary source: Florida DBPR</h2>
      <p>
        Every active contractor license on this site comes from a single source:
        the Florida Department of Business and Professional Regulation (DBPR),
        specifically its Construction Industry Licensing Board (CILB) database.
      </p>
      <p>
        DBPR is the state agency that licenses, regulates, and disciplines
        contractors in Florida. Every certified contractor working legally in this
        state has a record in DBPR&rsquo;s licensing system. That record is public
        information under Chapter 119 of the Florida Statutes, the state&rsquo;s
        Public Records Act.
      </p>
      <p>
        DBPR publishes a weekly data extract of all active contractor licenses.
        That extract is the source for everything you see on this site.
      </p>

      <div className="border border-gray-200 bg-paper-raised px-6 py-5">
        <dl>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            Source URL
          </dt>
          <dd className="mb-4 mt-1 break-all font-mono text-note">
            myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv
          </dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            File format
          </dt>
          <dd className="mb-4 mt-1">
            Comma-separated values (CSV), no header row, 22 columns
          </dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            Records
          </dt>
          <dd className="mb-4 mt-1">
            {contractorCountLabel()} records (as of latest refresh)
          </dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            Refresh cadence
          </dt>
          <dd className="mt-1">Weekly, every Sunday at 02:00 ET</dd>
        </dl>
      </div>

      <h2>What&rsquo;s in the data</h2>
      <p>
        Each contractor record from DBPR includes the following fields. All of
        these are publicly disclosed by the State of Florida &mdash; we republish
        them as received:
      </p>
      <ul>
        <li>License number and license type code</li>
        <li>
          Business name (for qualifying business records) or licensee name (for
          individuals)
        </li>
        <li>Qualifying agent name (the licensed person backing the business)</li>
        <li>Mailing address (city, county, state, ZIP)</li>
        <li>
          License status &mdash; Current, Delinquent, Null and Void, or similar
        </li>
        <li>Original license date and expiration date</li>
        <li>Any disciplinary action codes attached to the license</li>
      </ul>
      <p>
        DBPR does not include personal phone numbers, personal email addresses, or
        photos in its public extract. The business website, contact email, photo,
        and About text shown on a claimed profile are added by the contractor
        themselves after they verify ownership.
      </p>

      <h2>What&rsquo;s NOT in the data</h2>
      <p>
        Several things you might expect to find on a contractor directory are
        deliberately absent here, because DBPR doesn&rsquo;t publish them in its
        public extract:
      </p>
      <ul>
        <li>
          <strong>Insurance information.</strong> Workers&rsquo; compensation
          insurance status (separate Florida workers&rsquo; comp database)
        </li>
        <li>
          <strong>Customer reviews.</strong> Reviews are a separate moderation
          layer we may build in the future; they require an entirely different
          infrastructure (claim verification, response handling, moderation) that
          we don&rsquo;t want to launch poorly
        </li>
        <li>
          <strong>Surety bond information.</strong> Florida doesn&rsquo;t
          centralize bond data the way some states do; bonding is typically
          transaction-specific
        </li>
        <li>
          <strong>Project portfolios.</strong> Past project history of any kind
        </li>
        <li>
          <strong>Pricing information.</strong> Pricing data
        </li>
      </ul>
      <p>
        Where one of these matters for your contractor decision,{" "}
        <Link href="/hiring-checklist">
          our hiring checklist explains how to ask for them directly
        </Link>
        .
      </p>

      <h2>How current the data is</h2>
      <p>
        DBPR updates its public extract weekly. Our system pulls the latest
        version every Sunday at 2:00 AM Eastern Time. This means:
      </p>
      <ul>
        <li>Most data on this site is between 0 and 7 days old</li>
        <li>A newly issued license may take up to a week to appear here</li>
        <li>
          A recently revoked or expired license may still appear here for up to a
          week after the status change
        </li>
      </ul>
      <p>
        Every page on this site shows a &ldquo;Last refresh&rdquo; timestamp in the
        header strip. If you need real-time, official confirmation of a license
        status, the State of Florida&rsquo;s verification tool at{" "}
        <a
          href="https://www.myfloridalicense.com"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          myfloridalicense.com
        </a>{" "}
        is the authoritative source.
      </p>

      <h2>Legal basis for republication</h2>
      <p>
        Chapter 119 of the Florida Statutes &mdash; the Florida Public Records Act
        &mdash; establishes that records held by Florida state agencies are
        presumed to be public, available for inspection by anyone, and may be
        redistributed without permission unless a specific exemption applies.
        Contractor licensing records do not have such an exemption. They are public
        records, fully and lawfully available for republication.
      </p>
      <p>
        This legal foundation is what allows us to operate. It&rsquo;s also what
        allows any contractor to publish their own license information on their own
        website, and what allows news organizations, researchers, and other
        directories to do the same.
      </p>

      <h2>Corrections and removals</h2>
      <p>
        If you&rsquo;re a licensed contractor and your profile contains an error
        &mdash; wrong address, misspelled name, wrong license type &mdash; the
        fastest path to a correction is to{" "}
        <Link href="/join">claim your profile</Link>, then contact us.
        We&rsquo;ll fix the error within one business day.
      </p>
      <p>
        If the error is in DBPR&rsquo;s record (and not just on our site),
        you&rsquo;ll need to update it with DBPR directly through their licensee
        portal. Once you&rsquo;ve made the correction with the state, it will
        appear here at the next weekly sync.
      </p>
      <p>
        We cannot remove a profile while a license is active and on the DBPR public
        extract. The information is in the public record. Removing it from our site
        wouldn&rsquo;t remove it from the state&rsquo;s record or from anyone else
        who chooses to publish it. What we can do is correct factual errors,
        suppress historical addresses you&rsquo;ve moved away from, and make sure
        the information shown is accurate.
      </p>
    </ContentPageLayout>
  );
}
