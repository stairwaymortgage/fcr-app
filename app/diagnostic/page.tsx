import type { Metadata } from "next";
import Link from "next/link";

import ContentPageLayout from "@/components/ContentPageLayout";

/**
 * Diagnostic — /diagnostic  (PLACEHOLDER)
 *
 * The real thing is a 7-question multi-step flow ending in a phone-capture form
 * with TCPA consent — Build Brief Week 4, Days 1–4, mockup
 * 03_conversion_flow/diagnostic_flow_v2.html. It needs the persona routing
 * logic, the leads write and the GoHighLevel integration, none of which exist.
 *
 * NOTHING CURRENTLY LINKS HERE. The conversion banner that would point at this
 * route has deliberately not been built on the homepage, profile or county
 * pages — Build Brief line 855 places banner placement in Week 4 Day 5,
 * alongside the flow it feeds. This page exists so that when the banner does
 * land, its destination already resolves.
 *
 * DELIBERATELY NOT A FORM. A placeholder that collected a name and phone number
 * would be the worst possible version of this page: it would gather PII with no
 * TCPA consent language, no leads-table write path, and no one to follow up —
 * exactly the compliance exposure the real flow is carefully designed around.
 * It explains and points at what does work instead.
 */

export const metadata: Metadata = {
  title: "Project planning · Florida Contractor Registry",
  description:
    "A short questionnaire to help Florida homeowners think through the financial side of a construction project. Coming soon.",
  alternates: { canonical: "/diagnostic" },
  robots: { index: false, follow: true },
};

export default function DiagnosticPage() {
  return (
    <ContentPageLayout
      slug="/diagnostic"
      kicker="Before You Sign"
      h1Plain="Planning questions,"
      h1Em="coming soon."
      lede="A short set of questions to help you think through the financial side of a project before you commit to it."
      readMinutes={1}
      metaLabel="Page last updated"
    >
      <h2>What this will be</h2>
      <p>
        Most Florida homeowners decide how to pay for a project after they have
        chosen a contractor, which is the wrong way round &mdash; the financing
        shapes what the project can be. This will be a short questionnaire, about
        sixty seconds, that helps you work out which options are worth
        considering for your situation before you sign anything.
      </p>
      <p>
        It is not a quote, an application, or a credit check. At the end you can
        choose to speak with a licensed Florida professional, or simply take the
        summary and do nothing.
      </p>

      <h2>It is not ready yet</h2>
      <p>
        We would rather show you nothing than a version that collects your phone
        number without the consent language, follow-up and privacy handling it
        needs. When it is ready, it will be here.
      </p>

      <h2>What you can do now</h2>
      <p>
        Verifying the contractor is the step that protects you most, and that
        part of the site works today.
      </p>
      <ul>
        <li>
          <Link href="/search">Search the registry</Link> by business name,
          licence number or city
        </li>
        <li>
          Browse <Link href="/counties">by county</Link> or{" "}
          <Link href="/types">by licence type</Link> to see who is licensed near
          you
        </li>
        <li>
          Check any licence against the DBPR record at{" "}
          <a
            href="https://www.myfloridalicense.com"
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            myfloridalicense.com
          </a>{" "}
          &mdash; the authoritative source
        </li>
      </ul>
    </ContentPageLayout>
  );
}
