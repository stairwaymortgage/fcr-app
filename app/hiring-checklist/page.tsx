import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout from "@/components/ContentPageLayout";

/**
 * Hiring Checklist — /hiring-checklist
 * Source: _handoff/02_mockups_production/06_content_pages/hiring_checklist.html
 *
 * Mockup copy as written. The three <ol> lists restart at 1 in the mockup —
 * items 1–4, then 1–4, then 1–4 under their own section headings — rather than
 * running 1–12. Preserved, because each section is a self-contained checklist
 * and the summary refers to "the other nine items", which only reads correctly
 * against per-section numbering.
 */

export const metadata: Metadata = {
  title: "Hiring checklist · Florida Contractor Registry",
  description:
    "Twelve checks to run before signing with a Florida contractor — license, insurance, and contract.",
  alternates: { canonical: "/hiring-checklist" },
};

export default function HiringChecklistPage() {
  return (
    <ContentPageLayout
      slug="/hiring-checklist"
      kicker="Before You Sign Any Contractor"
      h1Plain="Hiring"
      h1Em="checklist."
      lede="Twelve items, three sections, about thirty minutes. The right questions to ask — and answers to confirm — before a contractor starts work on your home."
      readMinutes={5}
      metaLabel="Page last updated"
    >
      <p>
        Most contractor problems in Florida &mdash; the kind that show up later as
        lawsuits, mechanics&rsquo; liens, or unfinished work &mdash; can be
        prevented at one specific moment: before you sign the contract. Once your
        signature is on a piece of paper and money has changed hands, your options
        narrow dramatically. Before that point, you have every advantage.
      </p>
      <p>
        This is a checklist for that moment. It&rsquo;s twelve items, organized
        into three sections, and most homeowners can work through all of them in
        about thirty minutes. None of it requires legal training. Most of it is
        just asking the right questions and confirming the answers.
      </p>

      <h2>
        Section one: <em>The license check</em>
      </h2>
      <p>
        This is the part people skip, and it&rsquo;s the most important part.
        Florida law makes unlicensed contracting a third-degree felony when the
        work involved is over $5,000, and you do not want to find out at the end of
        a project that you&rsquo;ve paid someone who can&rsquo;t legally do the
        work.
      </p>
      <ol>
        <li>
          <strong>
            Get the license number and license type from the contractor in
            writing.
          </strong>{" "}
          Not verbally. The contract or proposal you receive should have both. If
          the contractor is reluctant to put this in writing, that&rsquo;s a
          signal.
        </li>
        <li>
          <strong>Verify the license is active</strong> at{" "}
          <a
            href="https://www.myfloridalicense.com"
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            myfloridalicense.com
          </a>{" "}
          or here on this site. &ldquo;Active&rdquo; means the status shows Current
          &mdash; not Delinquent, Null and Void, or anything else. An expired or
          delinquent license means the contractor cannot legally pull permits or
          perform the work.
        </li>
        <li>
          <strong>Match the license type to the work you need.</strong> A certified
          general contractor (CGC) can do most construction work. A certified
          residential contractor (CRC) is limited to one- and two-family homes. A
          roofing license (CCC) doesn&rsquo;t cover electrical work. An electrical
          license doesn&rsquo;t cover plumbing. The license type defines what the
          contractor is legally allowed to do.
        </li>
        <li>
          <strong>Check the qualifying agent.</strong> If you&rsquo;re hiring a
          contracting business, that business is operating under the personal
          license of an individual called the &ldquo;qualifying agent&rdquo; or
          &ldquo;qualifier.&rdquo; Look at who that person is. If the qualifying
          agent recently changed &mdash; say, in the last six months &mdash; ask
          why. Sometimes this is innocent (the original qualifier retired).
          Sometimes it&rsquo;s a sign of trouble (the business is being passed
          around between license holders, which can be a fraud pattern).
        </li>
      </ol>

      <h2>
        Section two: <em>The financial check</em>
      </h2>
      <p>
        This section is about making sure the contractor can actually do the work
        without leaving you holding the bag for someone else&rsquo;s costs.
      </p>
      <ol>
        <li>
          <strong>Ask for proof of general liability insurance.</strong> The
          contractor&rsquo;s certificate of insurance should name them or their
          business and show coverage that&rsquo;s actually in force right now.
          Don&rsquo;t accept a screenshot of an old document. Ask the
          contractor&rsquo;s insurance broker to send proof of coverage directly to
          you &mdash; it takes one phone call.
        </li>
        <li>
          <strong>
            Ask for proof of workers&rsquo; compensation insurance, OR a valid
            workers&rsquo; comp exemption.
          </strong>{" "}
          If the contractor has employees, they&rsquo;re legally required to carry
          workers&rsquo; comp. If they&rsquo;re a sole proprietor with no
          employees, they may legally hold an exemption. Either way, you want to
          see proof. If they don&rsquo;t have coverage AND don&rsquo;t have an
          exemption, and someone gets hurt on your property, you may be personally
          liable.
        </li>
        <li>
          <strong>Check for any disciplinary history.</strong> The State of Florida
          publishes contractor disciplinary actions on the DBPR website. A pattern
          of complaints, fines, or license suspensions is a major warning. A single
          old issue from years ago that was resolved is usually not.
        </li>
        <li>
          <strong>Ask about the payment schedule.</strong> Florida law allows
          contractors to ask for a deposit of up to 10% of the contract price
          before any work begins. Anyone asking for substantially more than that as
          a deposit &mdash; especially anyone asking for the full amount up front
          &mdash; is operating in a way you should be cautious about.
        </li>
      </ol>

      <h2>
        Section three: <em>The contract check</em>
      </h2>
      <p>
        This is the part that turns into a lawsuit if it goes wrong. Take your time
        here.
      </p>
      <ol>
        <li>
          <strong>Get everything in writing.</strong> Every promise, every change
          order, every modification to the original scope. Verbal agreements with
          contractors don&rsquo;t survive disputes.
        </li>
        <li>
          <strong>Make sure permits are addressed.</strong> The contract should
          specify who is responsible for pulling required permits &mdash; usually
          the contractor, since they need to be licensed to do so. If the project
          requires permits and the contractor wants you to pull them yourself, ask
          why. Sometimes it&rsquo;s because they&rsquo;re not properly licensed to
          pull them.
        </li>
        <li>
          <strong>Read the lien waiver language.</strong> Florida law gives
          contractors and subcontractors the right to file a lien against your
          property if they don&rsquo;t get paid. This includes subcontractors that
          the general contractor hired &mdash; even if you&rsquo;ve paid the general
          in full, an unpaid subcontractor can put a lien on your house. Make sure
          your contract includes lien waivers tied to each payment milestone, and
          ask for waivers from subcontractors as work progresses.
        </li>
        <li>
          <strong>Define what &ldquo;done&rdquo; means.</strong> The contract should
          specify what completion looks like &mdash; what triggers the final
          payment, what the punch list process is, who decides when work is
          acceptable. Without this, the last 10% of any project can turn into a
          dispute.
        </li>
      </ol>

      <h2>The summary</h2>
      <p>
        If you do nothing else, do these three things:{" "}
        <strong>
          verify the license is active and matches the work, get proof of insurance
          directly from the insurance company, and require a written contract with
          clear payment milestones.
        </strong>{" "}
        These three steps prevent the majority of serious contractor problems.
      </p>
      <p>
        The other nine items on the list reduce risk further. They&rsquo;re worth
        doing on any project over $10,000. On a major renovation, they&rsquo;re
        worth doing twice.
      </p>
      <p>
        <Link href="/verify">
          Our step-by-step guide to verifying a license
        </Link>{" "}
        covers section one in more detail.
      </p>
    </ContentPageLayout>
  );
}
