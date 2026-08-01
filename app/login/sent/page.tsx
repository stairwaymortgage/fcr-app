import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { DATA_AS_OF } from "@/lib/registry-stats";

import CodeForm from "./CodeForm";

/**
 * Check your email — /login/sent
 * Source: _handoff/02_mockups_production/05_auth/login_sent.html
 *
 * The address is echoed back so a typo is visible, and passed to the verify
 * action as the other half of the code. It arrives in the query string, so it
 * is NOT proof of anything on its own — an address here with the wrong code
 * gets nowhere, and Supabase pairs the two.
 */

export const metadata: Metadata = {
  title: "Enter your sign-in code · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

export default function LoginSentPage({
  searchParams,
}: {
  searchParams: { email?: string; next?: string };
}) {
  // Trimmed to a sane length so a crafted query string cannot wreck the layout.
  const email = (searchParams.email ?? "").slice(0, 254);

  return (
    <>
      <Header statsTimestamp={DATA_AS_OF} />
      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[520px] px-6 py-20 max-[700px]:py-12">
          <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
            One more step
          </p>
          <h1 className="mb-4 font-serif text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy max-[700px]:text-[27px]">
            Enter your <em className="not-italic text-gold">code.</em>
          </h1>
          <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">
            {email ? (
              <>
                We sent a sign-in code to{" "}
                <strong className="font-semibold text-navy">{email}</strong>.
                Type it below and you&rsquo;re in.
              </>
            ) : (
              <>We sent you a sign-in code. Type it below and you&rsquo;re in.</>
            )}
          </p>

          {email ? (
            <div className="mb-8 border border-gray-200 bg-paper-raised px-8 py-8 max-[700px]:px-5">
              <CodeForm email={email} next={searchParams.next} />
            </div>
          ) : (
            <p className="mb-8 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error">
              We&rsquo;ve lost track of which address you used.{" "}
              <Link href="/login">Start again</Link> and we&rsquo;ll send a fresh code.
            </p>
          )}

          <div className="border border-gray-200 bg-paper-raised px-6 py-5">
            <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
              Nothing arrived?
            </p>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-note leading-[1.6] text-gray-700">
              <li>Give it a minute — delivery is usually quick but not instant.</li>
              <li>Check your spam or promotions folder.</li>
              <li>
                Use &ldquo;Send a new code&rdquo; above, or{" "}
                <Link href="/login">start again with a different address</Link>.
              </li>
            </ul>
          </div>

          <p className="mt-8 text-note leading-[1.6] text-gray-600">
            The code works once and expires shortly after it&rsquo;s sent. We use a
            code rather than a link because some email providers scan links
            automatically, which uses the link up before you ever click it.
          </p>
        </div>
      </main>
      <Footer lastSyncDate={DATA_AS_OF} />
    </>
  );
}
