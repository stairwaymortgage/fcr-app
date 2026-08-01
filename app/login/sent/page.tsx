import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { DATA_AS_OF } from "@/lib/registry-stats";

/**
 * Check your email — /login/sent
 * Source: _handoff/02_mockups_production/05_auth/login_sent.html
 *
 * The address is echoed back purely so a typo is visible. It arrives in the
 * query string and is rendered as text — never used to look anything up, and
 * never treated as proof of anything. The link in the email is what carries
 * the identity.
 */

export const metadata: Metadata = {
  title: "Check your email · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

export default function LoginSentPage({
  searchParams,
}: {
  searchParams: { email?: string };
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
            Check your <em className="not-italic text-gold">email.</em>
          </h1>
          <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">
            {email ? (
              <>
                We sent a sign-in link to{" "}
                <strong className="font-semibold text-navy">{email}</strong>.
                Click it and you&rsquo;ll be signed in.
              </>
            ) : (
              <>
                We sent you a sign-in link. Click it and you&rsquo;ll be signed
                in.
              </>
            )}
          </p>

          <div className="border border-gray-200 bg-paper-raised px-6 py-5">
            <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
              Nothing arrived?
            </p>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-note leading-[1.6] text-gray-700">
              <li>Give it a minute — delivery is usually quick but not instant.</li>
              <li>Check your spam or promotions folder.</li>
              <li>
                Confirm the address is right, then{" "}
                <Link href="/login">request a new link</Link>.
              </li>
            </ul>
          </div>

          <p className="mt-8 text-note leading-[1.6] text-gray-600">
            The link works once and expires shortly after it&rsquo;s sent. If it
            has gone stale, just request another.
          </p>
        </div>
      </main>
      <Footer lastSyncDate={DATA_AS_OF} />
    </>
  );
}
