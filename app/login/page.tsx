import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { dataAsOf } from "@/lib/data-as-of";
import { getUser } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";

import LoginForm from "./LoginForm";

/**
 * Sign in — /login
 * Source: _handoff/02_mockups_production/05_auth/login.html
 *
 * Passwordless by design. Build Brief §Auth: "Supabase Auth (magic links). No
 * passwords. Email-based magic link for contractors and admins."
 *
 * noindex: a sign-in page has nothing to offer search, and indexing it invites
 * traffic that can only bounce.
 */

export const metadata: Metadata = {
  title: "Sign in · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const asOf = await dataAsOf();

  /**
   * Already signed in? Don't show a sign-in form — send them where they were
   * going.
   *
   * safeNext() IS APPLIED HERE, BY THIS FILE. Nothing else validates this path:
   * the redirect fires immediately, server-side, and /auth/callback is never
   * involved. An earlier version of this comment claimed the callback's rules
   * covered it — they do not, and the inline check that claim excused was
   * weaker than safeNext. It accepted "/\evil.com", which a browser that
   * normalises the backslash reads as protocol-relative, and accepted control
   * characters and whitespace.
   *
   * ?next is attacker-controlled here just as it is in the callback — it is a
   * query string on a public URL — so it gets the same function, and the reasons
   * live in lib/safe-next.ts rather than being restated in each caller.
   */
  const user = await getUser();
  if (user) {
    redirect(safeNext(searchParams.next));
  }

  return (
    <>
      <Header statsTimestamp={asOf} />
      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[520px] px-6 py-20 max-[700px]:py-12">
          <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
            Contractor access
          </p>
          <h1 className="mb-4 font-serif text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy max-[700px]:text-[27px]">
            Sign in to your <em className="not-italic text-gold">profile.</em>
          </h1>
          <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">
            Enter the email address you used when you claimed your profile.
            We&rsquo;ll send you a sign-in link.
          </p>

          <div className="border border-gray-200 bg-paper-raised px-8 py-8 max-[700px]:px-5">
            <LoginForm next={searchParams.next} />
          </div>

          <div className="mt-8 border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
            <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
              We don&rsquo;t use passwords
            </p>
            <p className="text-note leading-[1.6] text-gray-700">
              Every time you sign in, we send a one-time link to your email
              address. Click the link and you&rsquo;re in. Nothing to remember,
              and nothing that can be stolen from us.
            </p>
          </div>

          <p className="mt-8 text-note leading-[1.6] text-gray-600">
            Haven&rsquo;t claimed your profile yet?{" "}
            <Link href="/join">Find your license</Link> to get started.
          </p>
        </div>
      </main>
      <Footer lastSyncDate={asOf} />
    </>
  );
}
