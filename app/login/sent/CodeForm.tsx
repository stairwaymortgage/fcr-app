"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Spinner } from "@/components/SubmitButton";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { safeNext } from "@/lib/safe-next";

import { resolveLoginLanding, sendLoginCode, verifyLoginCode } from "../actions";

/**
 * Code entry.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * maxLength IS 12, NOT 6, AND THERE IS NO SIX-BOX SPLIT UI.
 *
 * This project issues EIGHT-digit codes, not the six most one-time-code UIs
 * assume. A maxLength of 6 — or six separate single-character boxes, the
 * fashionable treatment — would silently truncate every real code, and the
 * contractor would see "that code is wrong" while looking straight at the
 * right number. One field, digits extracted on the server.
 *
 * 12 is not arbitrary: it is the upper bound verifyLoginCode enforces in
 * ../actions.ts, which accepts 4–12 digits after stripping non-digits. The two
 * must stay in step. A cap BELOW the server's would truncate a code the server
 * would have accepted — the same bug as a maxLength of 6, just rarer and so
 * harder to spot.
 *
 * inputMode="numeric" brings up the number pad on a phone, which is where
 * contractors read their email. autoComplete="one-time-code" lets iOS and
 * Android offer the code straight from the notification, so on the common path
 * they never type it at all.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export default function CodeForm({ email, next }: { email: string; next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);

    const result = await verifyLoginCode({
      email,
      token: String(formData.get("token") ?? ""),
    });

    if (!result.ok) {
      setPending(false);
      setError(result.error ?? "That code didn't work. Request a new one.");
      return;
    }

    /**
     * verifyOtp wrote the session cookies from the Server Action. router.refresh
     * makes the server re-render with them before navigating, so the
     * destination does not render its signed-out state for a frame.
     *
     * THE DESTINATION IS RESOLVED ON THE SERVER, not here. resolveLoginLanding
     * still validates `next` — it is attacker-supplied on this path too, via the
     * query string — and when there is no usable one it picks by role: admins to
     * /admin/claims, a contractor to the profile they manage. Neither of those
     * questions can be answered in the browser.
     *
     * safeNext() is kept as the fallback for the failure case below, so a
     * server-side hiccup can never turn into an unvalidated navigation.
     */
    router.refresh();

    let destination: string;
    try {
      destination = await resolveLoginLanding(next);
    } catch {
      destination = safeNext(next);
    }
    router.push(destination);
  }

  async function onResend() {
    setResending(true);
    setError(null);
    await sendLoginCode({ email, next: next ?? "", website: "" });
    setResending(false);
    setResent(true);
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={onSubmit} className="flex flex-col gap-4">
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
            Sign-in code
          </span>
          <input
            name="token"
            type="text"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={12}
            placeholder="Enter the code from your email"
            className="w-full border border-gray-300 bg-white px-3.5 py-2.5 text-center font-mono text-[22px] tracking-[0.3em] text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className={`inline-flex items-center justify-center gap-2 bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-deep disabled:opacity-60 ${FOCUS_RING_PAPER}`}
        >
          {pending && <Spinner />}
          {pending ? "Checking…" : "Sign in →"}
        </button>
      </form>

      <div className="flex items-baseline gap-3 text-note text-gray-600">
        <button
          type="button"
          onClick={onResend}
          disabled={resending}
          className="font-mono text-label uppercase tracking-label text-gold disabled:opacity-60"
        >
          {resending ? "Sending…" : "Send a new code"}
        </button>
        {resent && <span role="status">Sent — check your email again.</span>}
      </div>
    </div>
  );
}
