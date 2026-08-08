import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout from "@/components/ContentPageLayout";
import { contractorCountLabel } from "@/lib/registry-stats";
import { publicPageMetadata } from "@/lib/seo";

/**
 * About — /about
 * Source: _handoff/02_mockups_production/06_content_pages/about.html
 *
 * ONE SUBSTANTIVE EDIT TO THE MOCKUP COPY, AND IT IS DELIBERATE. The mockup
 * reads "266,312 of them" describing "every active contractor license". Both
 * halves of that were wrong and the wording was already corrected sitewide on
 * 2026-07-30: the figure is 266,305 records, and they are records rather than
 * active licences (119,330 are an unexpired 'Current' licence).
 *
 * So the count renders from CONTRACTOR_COUNT like everywhere else, and the
 * sentence says "contractor records". Publishing the mockup's phrasing here
 * would reintroduce, on the page that explains what the site is, exactly the
 * claim the rest of the site stopped making.
 *
 * Everything else is the mockup's copy as written.
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
  title: "About the registry · Florida Contractor Registry",
  description:
    "Why Florida Contractor Registry exists, what it is, what it is not, and who operates it — a note from the publisher on how the registry started and why.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <ContentPageLayout
      slug="/about"
      kicker="A Note From the Publisher"
      h1Plain="About the"
      h1Em="registry."
      lede="Florida Contractor Registry started with a frustrating moment that thousands of Florida homeowners have every year."
      readMinutes={4}
      metaLabel="Page last updated"
    >
      <p>
        A contractor walks into a kitchen, shakes the homeowner&rsquo;s hand, and
        starts talking about timelines and budgets. The homeowner wants to verify
        the license &mdash; that&rsquo;s the responsible thing to do &mdash; but
        the official state database is hard to search, the URLs are intimidating,
        and the results show a wall of codes most people can&rsquo;t read. The
        check that should take five minutes ends up either skipped or attempted,
        abandoned, and the homeowner signs a $40,000 contract on a hope and a
        handshake.
      </p>
      <p>Public records shouldn&rsquo;t be that hard to use.</p>
      <p>
        We built this registry to fix that one specific problem. Every contractor
        license record issued by the Florida Department of Business and
        Professional Regulation is here &mdash;{" "}
        <strong>{contractorCountLabel()} of them</strong> &mdash; and each one has
        a profile page that&rsquo;s readable, searchable, and indexed by Google so
        you can find it when you need it.
      </p>

      <h2>
        What this site <em>is</em>
      </h2>
      <p>
        Florida Contractor Registry is a private commercial directory built from
        Florida public records under Chapter 119 of the Florida Statutes. We
        aggregate the weekly DBPR data extract and present each
        contractor&rsquo;s license information as a public-facing profile page.
      </p>
      <p>We do three things:</p>
      <ul>
        <li>
          <strong>First,</strong> we aggregate public license data from the State
          of Florida and make it searchable
        </li>
        <li>
          <strong>Second,</strong> we provide a free way for licensed contractors
          to claim their profile, control their information, and add a verified
          business photo, website, and contact details
        </li>
        <li>
          <strong>Third,</strong> we connect homeowners with a small advisory team
          that can help them think through the financial decisions that come with
          a major contracting project &mdash; financing, equity, planning around a
          sale or refinance &mdash; at no cost
        </li>
      </ul>
      <p>
        That third piece is how we keep the lights on. There&rsquo;s no
        advertising on this site. There&rsquo;s no &ldquo;sponsored
        contractor&rdquo; placement. There&rsquo;s no data sale. When a homeowner
        asks us for help thinking through their options, we connect them with a
        licensed Florida professional, which may include companies affiliated with
        us. If their conversation leads to actual business &mdash; a mortgage, a
        loan, a property transaction &mdash; that&rsquo;s how the registry funds
        itself.
      </p>

      <h2>
        What this site <em>is not</em>
      </h2>
      <p>
        This is not affiliated with the State of Florida, the Department of
        Business and Professional Regulation, the Construction Industry Licensing
        Board, or any government agency. We&rsquo;re a private business that
        republishes public data. We are not a regulator. We don&rsquo;t issue
        licenses. We don&rsquo;t take complaints (the State of Florida does &mdash;{" "}
        <Link href="/complaint">see our complaint guide</Link>). We don&rsquo;t
        endorse any contractor.
      </p>
      <p>
        This is also not a lead-generation platform that sells contractor contact
        data. Many directories do that. We don&rsquo;t &mdash; the contact
        details on a profile are the public DBPR record, or what a verified owner
        chose to publish. Homeowners who work through our questionnaire are
        called back by our own advisory team, and we say so on that page before
        anyone answers a question.
      </p>

      <h2>Why we built it the way we did</h2>
      <p>
        If you&rsquo;ve used contractor directory sites before, you&rsquo;ve
        probably noticed that most of them have the same problems: they&rsquo;re
        designed to capture leads aggressively, the visual design feels like a
        marketing funnel, the contractor profiles all look identical because
        they&rsquo;re driven by paid placement, and there&rsquo;s no real way to
        tell who&rsquo;s licensed and who isn&rsquo;t.
      </p>
      <p>
        We designed this site to feel less like a marketing funnel and more like a
        public registry. Editorial typography, restrained color, accurate data. The
        information you need to verify a contractor is presented the way a serious
        record system would present it &mdash; not the way an advertising platform
        would.
      </p>
      <p>
        The trade-off is that we have one quiet conversion mechanism on each
        profile page &mdash; an offer to talk to a licensed Florida professional,
        free, about the financial side of the project a homeowner is considering.
        That&rsquo;s the business model. We think it&rsquo;s a fair trade for the
        registry being useful and free for everyone who reads it.
      </p>

      <h2>Who we are</h2>
      <p>
        FloridaContractorRegistry.com is operated by Olga&rsquo;s Friends LLC, a
        Florida limited liability company. The advisory team you&rsquo;d talk to if
        you took us up on the free conversation is licensed under Florida real
        estate, mortgage, and business lending statutes. The contracting profiles
        published here are sourced from a Florida government dataset that is
        updated weekly.
      </p>
      <p>
        If you have questions about the data, the registry, or anything you see
        here, the addresses on our <Link href="/privacy">Privacy Policy</Link> and
        <Link href="/terms"> Terms of Service</Link> are the right place to start.
      </p>

      <h2>A final note for contractors</h2>
      <p>
        If you&rsquo;re a Florida contractor reading this and you&rsquo;ve just
        found out that your business has a profile on a site you&rsquo;ve never
        heard of &mdash; we understand the surprise. This isn&rsquo;t unique to us.
        Any public-records aggregator in any state has the same starting condition.
        The way to make your profile work for you is to claim it. It&rsquo;s free.
        It takes five minutes. Once claimed, you control what visitors see &mdash;
        your photo, your website, your About text, your own contact details
        &mdash; and your listing carries a verified badge instead of reading as a
        bare public record.
      </p>
      <p>
        <Link href="/join">Find your business and claim it</Link> &mdash; or, if
        it isn&rsquo;t here at all, ask us to add it from the same page.
      </p>
    </ContentPageLayout>
  );
}
