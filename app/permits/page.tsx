import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout from "@/components/ContentPageLayout";

/**
 * Permit Look-Up Guide — /permits
 * Source: _handoff/02_mockups_production/06_content_pages/permits.html
 *
 * Mockup copy as written. No factual corrections were needed — this page makes
 * no claim about the registry's own data, so the "active licences" problem that
 * required edits on /about, /sources and /verify does not arise here.
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
  title: "Permit look-up guide · Florida Contractor Registry",
  description:
    "How Florida permits work, what work requires one, and how to check whether your project's permits were pulled and closed.",
  alternates: { canonical: "/permits" },
};

export default function PermitsPage() {
  return (
    <ContentPageLayout
      slug="/permits"
      kicker="How to Check Permits on Your Project"
      h1Plain="Permit look-up"
      h1Em="guide."
      lede="Permits protect you. A permitted project has been reviewed for safety and code compliance. An unpermitted one hasn't."
      readMinutes={5}
      metaLabel="Page last updated"
    >
      <p>
        In Florida, most contracting work requires a permit. A permit is a written
        authorization from your local government &mdash; usually your city or
        county building department &mdash; confirming that the planned work meets
        code, that the contractor pulling the permit is properly licensed, and that
        the work will be inspected at key stages.
      </p>
      <p>
        Permits protect you. A permitted project has been reviewed for safety and
        code compliance. An unpermitted project hasn&rsquo;t. If something goes
        wrong on unpermitted work &mdash; a fire from bad electrical, structural
        failure from improper framing, water damage from a missed plumbing
        requirement &mdash; your insurance may deny the claim, and selling the
        house later will be complicated.
      </p>
      <p>
        This guide explains how permits work in Florida, what kinds of work require
        them, and how to check whether your project&rsquo;s permits were pulled and
        closed properly.
      </p>

      <h2>Who pulls the permit</h2>
      <p>
        The contractor pulls the permit, not the homeowner. This is important for a
        reason: when a licensed contractor pulls a permit, the contractor takes
        responsibility for the work meeting code. When a homeowner pulls a permit
        (which Florida allows in limited cases), the homeowner takes that
        responsibility.
      </p>
      <p>
        If a contractor asks you to pull the permit yourself &mdash; instead of
        pulling it themselves &mdash; that&rsquo;s almost always a sign of trouble.
        It usually means one of three things:
      </p>
      <ul>
        <li>
          They&rsquo;re not properly licensed for the work they&rsquo;re proposing
        </li>
        <li>
          They&rsquo;ve had disciplinary action that complicates their ability to
          pull permits
        </li>
        <li>They&rsquo;re trying to shift liability to you</li>
      </ul>
      <p>
        None of those are good outcomes for you. A properly licensed contractor
        doing work in their scope has no problem pulling permits themselves.
      </p>

      <h2>What kinds of work require permits</h2>
      <p>
        Permit requirements vary by jurisdiction in Florida, but the general
        categories are consistent across most cities and counties:
      </p>
      <ul>
        <li>
          <strong>Structural changes.</strong> Almost always permitted. Walls,
          roofs, foundations, additions, decks, anything load-bearing.
        </li>
        <li>
          <strong>Electrical work.</strong> Almost always permitted. New circuits,
          panel changes, anything that involves wiring inside walls.
        </li>
        <li>
          <strong>Plumbing work.</strong> Almost always permitted. New supply
          lines, new drain lines, water heaters in many jurisdictions.
        </li>
        <li>
          <strong>HVAC work.</strong> Almost always permitted. New systems, system
          replacement, ductwork.
        </li>
        <li>
          <strong>Roofing.</strong> Almost always permitted in Florida &mdash;
          local codes are strict because of hurricane requirements.
        </li>
        <li>
          <strong>Pool installation.</strong> Almost always permitted. Concrete
          pools, in-ground pools, screen enclosures.
        </li>
        <li>
          <strong>Windows and doors.</strong> Usually permitted for new windows and
          doors, especially if they&rsquo;re impact-rated or change opening size.
        </li>
        <li>
          <strong>Cosmetic interior work.</strong> Variable. Like-for-like swaps
          (cabinet replacement, fixture replacement, flooring) often don&rsquo;t
          require permits. Anything that touches walls, electrical, or plumbing
          usually does.
        </li>
      </ul>
      <p>
        Your contractor should be able to tell you upfront what permits a project
        requires. If they&rsquo;re unsure or evasive, call your local building
        department and ask directly &mdash; most building departments will tell a
        homeowner what&rsquo;s required for a given scope of work for free.
      </p>

      <h2>How to check whether a permit was pulled</h2>
      <p>
        Every Florida city and county building department has a permit search tool.
        You don&rsquo;t need an account or special access &mdash; these are public
        records, available to anyone.
      </p>
      <p>To check a permit:</p>
      <ol>
        <li>
          Find your local building department&rsquo;s permit search. A Google
          search for &ldquo;[your city or county] Florida permit search&rdquo; will
          usually surface it as the first result. Examples: Miami-Dade Permits,
          Broward County Permits, City of Tampa Permits, City of Orlando Permits.
        </li>
        <li>
          Search by your property address. The system will list every permit ever
          pulled at that address, including the date, the type of work, the permit
          number, the licensed contractor who pulled it, and the current status.
        </li>
        <li>
          Look for the permit related to your project. The contractor name should
          match the one you hired. The scope should match the work being done. The
          dates should align.
        </li>
        <li>
          Check the status. Permits go through stages &mdash; Applied, Issued, In
          Progress (with various inspections), and Finalized.
          &ldquo;Finalized&rdquo; or &ldquo;Closed&rdquo; means all required
          inspections passed and the work is officially approved. Anything else
          means the project isn&rsquo;t fully closed out.
        </li>
      </ol>

      <h2>What to do if there&rsquo;s no permit</h2>
      <p>
        If you check the address and find no permit for work your contractor is
        doing &mdash; or has already done &mdash; that&rsquo;s a serious problem.
        Your options depend on where you are in the project:
      </p>
      <ul>
        <li>
          <strong>Work hasn&rsquo;t started yet.</strong> Stop work. Ask the
          contractor to apply for the permit immediately. If they refuse or stall,
          you may have grounds to terminate the contract.
        </li>
        <li>
          <strong>Work is partially complete.</strong> This is harder. Some
          jurisdictions allow &ldquo;permit after the fact&rdquo; filings, which
          usually require a higher fee and full inspection of completed work. Some
          don&rsquo;t. Contact your building department directly &mdash;
          they&rsquo;ll tell you the local process.
        </li>
        <li>
          <strong>Work is done and contractor is gone.</strong> You inherit the
          problem. Unpermitted work can affect your homeowner&rsquo;s insurance and
          can become a major issue when you sell. Talk to a Florida real estate
          attorney about your options &mdash; sometimes you can pursue the
          contractor, sometimes you can permit after the fact, sometimes the work
          has to be removed.
        </li>
      </ul>

      <h2>Inspection sign-offs</h2>
      <p>
        On any permitted project, the building department schedules inspections at
        key milestones &mdash; usually after framing, after electrical/plumbing
        rough-in, after HVAC, and at final completion. Each inspection has to pass
        before the next stage of work can proceed.
      </p>
      <p>
        Ask your contractor to share inspection results with you as the project
        moves forward. The inspection record is also visible in the permit system
        &mdash; you can check it yourself anytime. If an inspection fails, the
        report will say why and what needs to be corrected. A failed inspection
        isn&rsquo;t necessarily a sign of a bad contractor; it&rsquo;s a sign that
        the system is working. Repeated failures on the same item, however, are
        worth asking about.
      </p>
      <p>
        When the final inspection passes, the permit is closed. That&rsquo;s the
        official sign-off that the work is complete and to code. Keep a record of
        the closed permit &mdash; you&rsquo;ll want it when you sell the house.
      </p>
      <p>
        Before any of this, though, the license check comes first &mdash; see{" "}
        <Link href="/verify">how to verify a license</Link> and the{" "}
        <Link href="/hiring-checklist">hiring checklist</Link>.
      </p>
    </ContentPageLayout>
  );
}
