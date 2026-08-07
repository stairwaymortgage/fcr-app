import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout from "@/components/ContentPageLayout";

/**
 * File a Complaint — /complaint
 * Source: _handoff/02_mockups_production/06_content_pages/complaint.html
 *
 * Mockup copy as written, including the DBPR phone number (850) 487-1395, the
 * form number (DBPR Form 0080-1), the $8,000 small-claims threshold, and the
 * recovery-fund limits ($25,000 per project / $50,000 aggregate). These are
 * third-party facts about Florida agencies rather than our own legal values, so
 * they are reproduced rather than invented — but they are also the kind of
 * figure that changes by statute, and nothing here re-checks them against the
 * current Florida Statutes. Worth a legal review pass before launch alongside
 * the DMCA agent details.
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
  title: "File a complaint · Florida Contractor Registry",
  description:
    "How to file a contractor complaint with Florida DBPR, what they investigate, and what the Construction Industries Recovery Fund covers.",
  alternates: { canonical: "/complaint" },
};

export default function ComplaintPage() {
  return (
    <ContentPageLayout
      slug="/complaint"
      kicker="When Something Goes Wrong"
      h1Plain="File a"
      h1Em="complaint."
      lede="Most contractor projects in Florida go fine. When they don't, there's a formal process — and it works better than most people expect."
      readMinutes={5}
      metaLabel="Page last updated"
    >
      <p>
        Most contractor projects in Florida go fine. But when they don&rsquo;t
        &mdash; when a contractor abandons a job, performs substandard work,
        refuses to make corrections, or operates without proper licensing &mdash;
        Florida has a formal complaint process. Filing a complaint is free,
        it&rsquo;s straightforward, and it sometimes (not always) leads to
        meaningful consequences.
      </p>
      <p>
        This guide walks through what kinds of complaints are appropriate, where to
        file them, what to expect from the process, and what your other options are
        when a complaint isn&rsquo;t enough.
      </p>

      <h2>
        Before you file: <em>try direct resolution first</em>
      </h2>
      <p>
        In a lot of cases, what looks like a serious contractor problem turns out
        to be a communication breakdown that can be resolved with a clear written
        conversation. Before escalating to a formal complaint:
      </p>
      <ol>
        <li>
          Document the specific issue in writing. Take photos. Keep records of
          dates, names, and exact problems.
        </li>
        <li>
          Send the contractor a written request to resolve the issue. Email is
          fine. Be specific about what you want fixed and by when.
        </li>
        <li>
          Give them a reasonable window to respond and correct the work &mdash;
          usually 10 to 14 business days for non-urgent issues.
        </li>
        <li>Keep all correspondence.</li>
      </ol>
      <p>
        If the contractor responds and fixes the problem, you&rsquo;re done. If
        they don&rsquo;t, you now have documentation that you tried &mdash; which
        strengthens any complaint or legal claim that follows.
      </p>
      <p>
        That said, in cases of fraud, complete abandonment of a job, or unlicensed
        contracting, skip the direct resolution step and go straight to the
        complaint process. Some situations don&rsquo;t deserve a second chance.
      </p>

      <h2>
        Where to file: <em>DBPR</em>
      </h2>
      <p>
        For most contractor complaints, the right place to file is the Florida
        Department of Business and Professional Regulation. DBPR has authority to
        investigate licensed contractors, issue fines, suspend licenses, and revoke
        them entirely. DBPR also has jurisdiction over unlicensed contracting.
      </p>

      <div className="border border-gray-200 bg-paper-raised px-6 py-5">
        <dl>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            Where to file
          </dt>
          <dd className="mb-4 mt-1">
            <a
              href="https://www.myfloridalicense.com"
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              myfloridalicense.com
            </a>{" "}
            &mdash; search for &ldquo;File a Complaint&rdquo;
          </dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            Phone
          </dt>
          <dd className="mb-4 mt-1">(850) 487-1395</dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            Cost
          </dt>
          <dd className="mb-4 mt-1">Free</dd>
          <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            Form
          </dt>
          <dd className="mt-1">DBPR Form 0080-1 (Consumer Complaint Form)</dd>
        </dl>
      </div>

      <h2>What DBPR investigates</h2>
      <p>
        DBPR has jurisdiction over a specific set of contractor issues. They
        investigate:
      </p>
      <ul>
        <li>
          Unlicensed contracting (doing work that requires a license without one)
        </li>
        <li>
          Contracting outside the scope of license (e.g., a roofer doing electrical
          work)
        </li>
        <li>Abandonment of a project (leaving without completing the work)</li>
        <li>
          Failure to honor a written warranty within the warranty period
        </li>
        <li>
          Misappropriation of funds (taking deposits and not performing work)
        </li>
        <li>Gross negligence, incompetence, or misconduct</li>
        <li>Operating with an expired or suspended license</li>
        <li>Fraud in obtaining or using a license</li>
      </ul>

      <h2>
        What DBPR does <em>not</em> investigate
      </h2>
      <p>
        DBPR is a licensing regulator, not a small claims court. They do not
        handle:
      </p>
      <ul>
        <li>
          Disagreements about the quality of work (unless it rises to gross
          negligence)
        </li>
        <li>Disputes about the price or value of work performed</li>
        <li>
          Recovery of money paid to a contractor (DBPR has a recovery fund &mdash;
          see below &mdash; but it&rsquo;s separate)
        </li>
        <li>Breach of contract disputes (those are civil court matters)</li>
      </ul>
      <p>
        For those issues, your options are civil court, small claims court (for
        amounts under $8,000 in Florida), or &mdash; for many homeowners &mdash;
        the Florida Construction Industries Recovery Fund.
      </p>

      <h2>The Florida Construction Industries Recovery Fund</h2>
      <p>
        Florida operates a specific fund that compensates homeowners for losses
        caused by licensed contractors who have been disciplined by DBPR. If a
        contractor takes your money and doesn&rsquo;t complete the work &mdash; and
        DBPR investigates and finds the contractor at fault &mdash; you may be able
        to recover up to $25,000 per project (and up to $50,000 in aggregate from
        any single contractor) from the recovery fund.
      </p>
      <p>
        The catch is that the fund only applies to losses from licensed contractors
        who have been disciplined. If the contractor was unlicensed, the recovery
        fund doesn&rsquo;t cover you. (This is one of many reasons to{" "}
        <Link href="/verify">verify the license before signing</Link>.)
      </p>
      <p>To apply for recovery fund compensation:</p>
      <ol>
        <li>
          File the DBPR complaint and wait for the investigation to complete
        </li>
        <li>
          If DBPR finds the contractor at fault and imposes discipline, you receive
          notice
        </li>
        <li>
          You file a separate claim with the recovery fund within one year of
          DBPR&rsquo;s final order
        </li>
      </ol>
      <p>
        The recovery process takes time &mdash; often a year or more &mdash; but it
        can result in real money recovered.
      </p>

      <h2>When to involve a lawyer</h2>
      <p>
        If your losses exceed what the recovery fund can cover, or if the
        contractor was unlicensed (which excludes recovery fund eligibility), or if
        the issue involves a complex contract dispute, you may need a Florida
        construction attorney.
      </p>
      <p>
        Florida has a strong construction litigation bar. Initial consultations are
        often free, and many construction attorneys work on contingency for
        clear-cut cases of contractor fraud. Look for an attorney with specific
        construction law experience, not a general practice.
      </p>
      <p>Issues that often warrant attorney involvement:</p>
      <ul>
        <li>Losses over $10,000 with no recovery fund eligibility</li>
        <li>
          Mechanics&rsquo; liens filed against your property by unpaid
          subcontractors
        </li>
        <li>
          Construction defects that emerge after the work is &ldquo;complete&rdquo;
        </li>
        <li>Contracts with arbitration clauses requiring formal proceedings</li>
      </ul>

      <h2>Reporting unlicensed contractors</h2>
      <p>
        Unlicensed contracting is a third-degree felony in Florida when the work
        involved is over $5,000 (Section 489.127 of the Florida Statutes). DBPR
        investigates and refers serious cases to local prosecutors.
      </p>
      <p>
        You can report an unlicensed contractor to DBPR using the same complaint
        form &mdash; there&rsquo;s a specific section for unlicensed activity. You
        can also report locally to your county sheriff&rsquo;s office, which often
        has economic crime units that handle these cases.
      </p>
      <p>
        Many Florida counties also run &ldquo;sting&rdquo; operations specifically
        targeting unlicensed contractors. Reporting a suspected unlicensed
        contractor &mdash; especially one who has solicited you door-to-door or
        after a storm &mdash; directly contributes to those enforcement efforts.
      </p>

      <h2>After-storm scams</h2>
      <p>
        Florida sees a predictable surge in unlicensed contractors and outright
        scammers after every major storm. Door-to-door solicitations offering
        immediate roof repair, debris cleanup, or storm damage assessments are red
        flags &mdash; legitimate contractors don&rsquo;t usually canvass
        neighborhoods this way.
      </p>
      <p>
        If you&rsquo;ve been approached by a contractor after a storm and they
        pressured you to sign on the spot, paid a deposit and they vanished, or had
        work done that doesn&rsquo;t match what was promised, report it to DBPR,
        your county sheriff, and the Florida Attorney General&rsquo;s office. These
        cases often involve criminal fraud and can result in real consequences for
        the contractor.
      </p>

      <h2>A final note</h2>
      <p>
        Most contractor problems can be prevented at the verification stage &mdash;{" "}
        <Link href="/verify">checking the license</Link>, getting proof of
        insurance, requiring a written contract. The complaint process exists for
        when those preventive measures weren&rsquo;t taken or weren&rsquo;t enough.
        Don&rsquo;t skip the prevention. But if you find yourself needing the
        complaint process, use it. Florida takes contractor regulation seriously,
        and the system works better than many people expect.
      </p>
    </ContentPageLayout>
  );
}
