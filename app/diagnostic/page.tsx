import type { Metadata } from "next";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { dataAsOf } from "@/lib/data-as-of";

import DiagnosticWizard from "./DiagnosticWizard";

/**
 * Diagnostic flow — /diagnostic
 * Source: _handoff/02_mockups_production/03_conversion_flow/diagnostic_flow_v2.html
 *
 * The page itself is a Server Component; only the wizard inside it is a client
 * component, which keeps Header and Footer out of the client bundle.
 *
 * `?from=<contractor-slug>` carries the referring profile through so the lead
 * records where it came from. It is validated in the Server Action before being
 * written, and it only ever becomes a referring_url string — never a lookup.
 *
 * noindex: this is a conversion flow, not content. It has nothing to rank for
 * and an indexed diagnostic competes with the profile pages that feed it.
 */

export const metadata: Metadata = {
  title: "Before you sign · Florida Contractor Registry",
  description:
    "A short set of questions to help Florida homeowners understand their options before committing to a contracting project.",
  alternates: { canonical: "/diagnostic" },
  robots: { index: false, follow: true },
};

export default async function DiagnosticPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  // Shape-checked here so nothing odd reaches the client component; the Server
  // Action validates it again before it is written.
  const raw = searchParams.from ?? "";
  const referringSlug = /^[a-z0-9-]{1,200}$/.test(raw) ? raw : undefined;
  const asOf = await dataAsOf();

  return (
    <>
      <Header statsTimestamp={asOf} />

      <main className="bg-gradient-to-b from-paper to-[#faf6ed] px-8 pb-[88px] pt-12">
        <div className="mx-auto mb-10 max-w-[720px] text-center">
          <p className="mb-3 inline-flex items-center gap-2.5 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
            <span aria-hidden="true" className="h-px w-6 bg-gold" />
            Before You Sign
          </p>
          <h1 className="mb-4 font-serif text-[40px] font-semibold leading-[1.1] tracking-[-0.025em] text-navy max-[700px]:text-[30px]">
            Make sure you have the{" "}
            <em className="italic">full picture.</em>
          </h1>
          <p className="mx-auto max-w-[560px] text-[17px] leading-[1.55] text-gray-700">
            Seven quick questions. No obligation, nothing to buy, and no credit
            check — just the options most homeowners don&rsquo;t know they have
            before committing to a project.
          </p>
        </div>

        <DiagnosticWizard referringSlug={referringSlug} />
      </main>

      <Footer lastSyncDate={asOf} />
    </>
  );
}
