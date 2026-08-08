import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout from "@/components/ContentPageLayout";
import { contractorCountLabel } from "@/lib/registry-stats";
import { publicPageMetadata } from "@/lib/seo";

/**
 * How to Verify a License — /verify
 * Source: _handoff/02_mockups_production/06_content_pages/verify.html
 *
 * TWO CORRECTIONS TO THE MOCKUP, both for the same reason as /about and
 * /sources: it must not restate a claim the rest of the site stopped making.
 *
 * 1. The closing line reads "There are 266,312 active licenses in Florida".
 *    Rendered as CONTRACTOR_COUNT records — 266,305, and records rather than
 *    active licences (119,330 are an unexpired 'Current' licence). Doubly wrong
 *    on this page: telling someone "no shortage of options" is only sound advice
 *    if the number means what it says.
 *
 * 2. The licence-type list includes "EC — Electrical Contractor". True of
 *    Florida, but DBPR publishes electrical licences in a SEPARATE extract this
 *    registry does not import, so searching here for an electrical contractor
 *    finds nothing. A verification guide that sends someone to check a licence
 *    we cannot show them is worse than useless, so the list carries a note.
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
  title: "How to verify a contractor license · Florida Contractor Registry",
  description:
    "A step-by-step guide to verifying a Florida contractor's license in about three minutes — where to look, what each license status means, and what to check.",
  path: "/verify",
});

export default function VerifyPage() {
  return (
    <ContentPageLayout
      slug="/verify"
      kicker="How to Check a Contractor's License"
      h1Plain="How to verify a"
      h1Em="license."
      lede="Verifying a Florida contractor's license takes about three minutes. Most people don't do it because they don't know how."
      readMinutes={4}
      metaLabel="Page last updated"
    >
      <p>
        Verifying a Florida contractor&rsquo;s license takes about three minutes.
        Most people don&rsquo;t do it because they don&rsquo;t know how. This guide
        walks through the process the way you&rsquo;d do it yourself, step by step.
      </p>

      <h2>The short version</h2>
      <div className="border-l-4 border-l-gold bg-gray-50 px-6 py-5">
        <p className="mb-0">
          To verify a Florida contractor&rsquo;s license, you need the license
          number and the contractor&rsquo;s name. With those two pieces of
          information, you can confirm in three places: the State of
          Florida&rsquo;s official verification tool at{" "}
          <a
            href="https://www.myfloridalicense.com"
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            myfloridalicense.com
          </a>
          , this registry, and the contractor&rsquo;s own business documentation.
          Cross-check all three. If anything disagrees, ask the contractor about
          the discrepancy before you sign.
        </p>
      </div>

      <h2>Step one: Get the license number</h2>
      <p>
        Every Florida contractor license has a number in a specific format &mdash;
        three letters followed by a series of digits. The letters identify the
        license type. Common ones:
      </p>
      <ul>
        <li>
          <strong>CGC</strong> &mdash; Certified General Contractor (general
          construction)
        </li>
        <li>
          <strong>CBC</strong> &mdash; Certified Building Contractor (one- to
          three-story buildings)
        </li>
        <li>
          <strong>CRC</strong> &mdash; Certified Residential Contractor (one- and
          two-family homes only)
        </li>
        <li>
          <strong>CCC</strong> &mdash; Certified Roofing Contractor
        </li>
        <li>
          <strong>CPC</strong> &mdash; Certified Pool/Spa Contractor
        </li>
        <li>
          <strong>CMC</strong> &mdash; Certified Mechanical Contractor (HVAC)
        </li>
        <li>
          <strong>EC</strong> &mdash; Electrical Contractor
        </li>
        <li>
          <strong>CFC</strong> &mdash; Certified Plumbing Contractor
        </li>
      </ul>
      <p className="text-note text-gray-500">
        Note: DBPR publishes electrical licenses (EC, ER, ES) in a separate extract
        that this registry does not currently import, so an electrical contractor
        may be fully licensed without appearing in a search here. Verify those at{" "}
        <a
          href="https://www.myfloridalicense.com"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          myfloridalicense.com
        </a>
        .
      </p>
      <p>
        Ask the contractor for their license number in writing &mdash; on their
        business card, their proposal, their email signature, or their contract.
        They should have no problem providing it. If they hesitate, that&rsquo;s a
        flag.
      </p>
      <p>Once you have the number, you can verify in any of three places.</p>

      <h2>Step two: Verify with the State of Florida</h2>
      <p>
        The official source is{" "}
        <a
          href="https://www.myfloridalicense.com"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          myfloridalicense.com
        </a>{" "}
        &mdash; operated by the Florida Department of Business and Professional
        Regulation. Here&rsquo;s the process:
      </p>
      <ol>
        <li>Go to myfloridalicense.com</li>
        <li>Click &ldquo;Verify a License&rdquo; in the main navigation</li>
        <li>Enter the license number (e.g., CGC1520921)</li>
        <li>
          The system returns the licensee&rsquo;s name, business name, license
          status, expiration date, and any disciplinary actions
        </li>
      </ol>
      <p>
        This is the authoritative source. If the State of Florida shows the license
        as Current and Active, with no disciplinary actions, the contractor is in
        good standing as of the date you check.
      </p>

      <h2>Step three: Cross-check with this registry</h2>
      <p>
        Florida Contractor Registry refreshes its data from DBPR weekly. The
        information here should match what&rsquo;s at{" "}
        <a
          href="https://www.myfloridalicense.com"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          myfloridalicense.com
        </a>{" "}
        &mdash; but our presentation makes a few things easier to spot:
      </p>
      <ul>
        <li>
          All licenses held by a single qualifying agent appear together (some
          contractors hold 4 or 5 licenses across different specialties &mdash;
          useful to see this in one place)
        </li>
        <li>
          The qualifying agent relationship is shown explicitly (you can see
          whether the business has had recent qualifier changes)
        </li>
        <li>
          Other contractors in the same county or city are easy to compare against
        </li>
      </ul>
      <p>
        <Link href="/search">
          Search the contractor by license number or business name
        </Link>
        . If the registry shows a license as Current that DBPR shows as Delinquent
        or worse, our data is at most one week stale &mdash; use the State of
        Florida&rsquo;s version as the authoritative answer.
      </p>

      <h2>Step four: Match what the contractor told you</h2>
      <p>
        This is the step most people skip, and it&rsquo;s where fraud often shows
        up. Take what you learned from the State and what you see on our registry,
        and compare it carefully to what the contractor has told you and given you
        in writing.
      </p>
      <p>Specifically, check the following:</p>
      <ul>
        <li>
          <strong>License number.</strong> Should match exactly across the
          contractor&rsquo;s business card, their proposal, the State of Florida
          record, and this registry. A typo on a business card is one thing; a
          different number on the proposal than what&rsquo;s on file with the state
          is a serious issue.
        </li>
        <li>
          <strong>Qualifying agent.</strong> The qualifying agent on file with the
          state should be a person who actually works for the business. If the
          contractor&rsquo;s website says &ldquo;John Smith, Owner&rdquo; and the
          State of Florida shows a different person as the qualifying agent, ask
          about the relationship.
        </li>
        <li>
          <strong>Scope of license.</strong> The license should be appropriate for
          the work being proposed. A CCC (roofing) doing kitchen renovations is not
          licensed for that work. A CRC (residential) trying to do work on your
          three-story commercial property is exceeding their scope.
        </li>
        <li>
          <strong>Expiration date.</strong> Should be at least 60 days away. A
          license that expires next month is fine if the contractor is going to
          renew, but you want to know in advance &mdash; and the renewal should
          happen before work begins.
        </li>
      </ul>

      <h2>Red flags during verification</h2>
      <p>
        Most license checks go smoothly. When they don&rsquo;t, it&rsquo;s usually
        for one of these reasons:
      </p>
      <ul>
        <li>
          <strong>The license is not Current.</strong> Stop here. They cannot
          legally pull permits or perform work over $5,000. Find someone else.
        </li>
        <li>
          <strong>The license doesn&rsquo;t exist.</strong> Some specialties
          (handyman work under $1,000, basic landscaping, very limited cosmetic
          work) don&rsquo;t require a state license. Most things you&rsquo;d hire a
          contractor for do. If you&rsquo;re proposing work over $5,000 and the
          contractor doesn&rsquo;t have a license, that&rsquo;s unlicensed
          contracting under Florida law.
        </li>
        <li>
          <strong>The qualifying agent changed recently.</strong> Ask why. Was the
          previous qualifying agent disciplined? Did they leave the business? A
          clean explanation is fine. An evasive one is not.
        </li>
        <li>
          <strong>The license shows disciplinary action codes.</strong> This
          usually means past disciplinary action. Look at the details on the DBPR
          record. Old, resolved issues from years ago are usually not a problem.
          Recent issues or repeated patterns are.
        </li>
        <li>
          <strong>The license type doesn&rsquo;t match the work.</strong> Means the
          contractor is doing work outside what they&rsquo;re licensed for. This is
          illegal even if the contractor has a different valid license.
        </li>
      </ul>

      <h2>If anything doesn&rsquo;t check out</h2>
      <p>Stop. Don&rsquo;t sign. Don&rsquo;t pay a deposit. Don&rsquo;t allow work to begin.</p>
      <p>
        It is much, much easier to walk away from a contractor at the verification
        stage than at any later stage. Once money has changed hands, your leverage
        drops to almost zero. Before money has changed hands, you have all the
        leverage.
      </p>
      <p>
        Find another contractor whose verification is clean. There are{" "}
        {contractorCountLabel()} contractor records in this registry &mdash;
        there&rsquo;s no shortage of options.
      </p>
    </ContentPageLayout>
  );
}
