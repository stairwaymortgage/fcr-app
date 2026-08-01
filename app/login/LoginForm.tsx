"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { FOCUS_RING_PAPER } from "@/lib/focus";

import { sendLoginCode } from "./actions";

/**
 * The email form. Client only because it needs pending state and an error
 * region; everything it can do is also enforced in the Server Action, which is
 * the actual boundary.
 */
export default function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);

    const email = String(formData.get("email") ?? "");
    const result = await sendLoginCode({
      email,
      next: next ?? "",
      website: String(formData.get("website") ?? ""),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Please try again.");
      return;
    }
    // The address is passed on only so the next page can display it. The link
    // itself is bound to the email, not to this navigation.
    const params = new URLSearchParams({ email });
    if (next) params.set("next", next);
    router.push(`/login/sent?${params.toString()}`);
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      {/* Honeypot — off-screen, hidden from assistive tech and keyboard. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="l-website">Website</label>
        <input id="l-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {error && (
        <p
          role="alert"
          className="border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error"
        >
          {error}
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
          Email address
        </span>
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          autoFocus
          placeholder="you@yourcompany.com"
          className="border border-gray-300 bg-white px-3.5 py-2.5 text-base text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className={`bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-light disabled:opacity-60 ${FOCUS_RING_PAPER}`}
      >
        {pending ? "Sending…" : "Email me a sign-in code →"}
      </button>
    </form>
  );
}
