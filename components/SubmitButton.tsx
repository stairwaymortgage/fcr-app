"use client";

import { useFormStatus } from "react-dom";

/**
 * Pending feedback for form submits — the spinner and the button that uses it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS: BETWEEN CLICK AND SERVER ACTION THERE WAS NOTHING.
 *
 * A Server Action round trip is a network request with no browser-native
 * affordance — no spinner in the tab, no greyed control, nothing. On a slow
 * connection the visitor clicks, sees an unchanged page, and clicks again. On
 * the inquiry form that produced duplicate leads delivered to a contractor who
 * is billed for them, which is why disable-on-click is a correctness fix here
 * and not decoration.
 *
 * The duplicate-suppression added alongside rate limiting is the server half of
 * that same fix. This is the client half: suppression stops the second row
 * being written, this stops the second request being sent.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ animate-spin PUTS THE FIRST @keyframes IN THIS PROJECT'S CSS.
 *
 * Before this component the compiled stylesheet contained no @keyframes at all
 * and no `animation` property — verified by grepping the built CSS, not
 * assumed. `transition-colors` appears ten times across the headers and lists,
 * so stock Tailwind motion utilities are established here; a keyframe animation
 * is a step past that, and the earlier decision to skip a pulse treatment means
 * it should be a decision rather than a side effect.
 *
 * WHAT IT IS NOT: a token addition. `animate-spin` ships in Tailwind's default
 * theme, so tailwind.config.ts is untouched and no colour, size or spacing
 * token is minted. It is one stock utility, and removing it is deleting one
 * class from one line of this file.
 *
 * motion-reduce:animate-none is not optional. The project has no
 * prefers-reduced-motion handling anywhere, so this component introduces the
 * first of that too — a spinner is precisely the kind of continuous motion that
 * setting exists for, and shipping one that ignores it would be a regression in
 * a codebase that has so far had no motion to get wrong.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * A rotating arc. Inline SVG, no icon library — the project ships none and one
 * spinner is not a reason to add a dependency.
 *
 * aria-hidden because the state is already announced: the button is disabled
 * and its label has changed to "Sending…". A third announcement from the icon
 * would be noise, and an icon is not the accessible carrier of that meaning.
 *
 * currentColor, so it inherits whatever the button's text colour is and needs
 * no variant per surface — navy button, white button, danger button all work.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none ${className}`}
    >
      {/* The full ring, faint — gives the arc something to travel around, so
          the shape reads as a spinner rather than a stray comma. */}
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      {/* A quarter of the ring, solid. strokeLinecap rounds the ends so it does
          not read as a hard-edged wedge at this size. */}
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface SubmitButtonProps {
  /** The idle label. */
  children: React.ReactNode;
  /** The label while the action is in flight, e.g. "Sending…". */
  pendingLabel: string;
  className?: string;
  /** Disabled for reasons of the caller's own, OR-ed with pending. */
  disabled?: boolean;
  /** Passed through for forms that route on the submitter's value. */
  name?: string;
  value?: string;
  "aria-label"?: string;
}

/**
 * A submit button that knows when its own form is in flight.
 *
 * ⚠ IT MUST BE RENDERED INSIDE THE <form>, NOT ALONGSIDE IT. useFormStatus
 * reports the status of the nearest form ABOVE it in the tree; called in the
 * component that renders the <form> it always reads false. That is the standard
 * trap with this hook, and the reason this is a separate component at all
 * rather than a few lines inline. The same note already sat on ProfileForm's
 * local Actions component, which this generalises.
 *
 * ⚠ IT ONLY WORKS ON FORMS WITH A FUNCTION ACTION. `action={serverAction}` and
 * `action={clientFn}` both report pending; `action="/some/url" method="post"`
 * is a native browser navigation that React never sees, so pending stays false
 * forever. The sign-out forms are that second kind deliberately and are left
 * alone — a native POST navigation has the browser's own loading indicator.
 */
export default function SubmitButton({
  children,
  pendingLabel,
  className = "",
  disabled = false,
  name,
  value,
  "aria-label": ariaLabel,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      aria-label={ariaLabel}
      disabled={pending || disabled}
      /**
       * aria-busy rather than a live region. The label swap alone is not
       * reliably announced — the button keeps focus through the transition, and
       * screen readers differ on whether a changed accessible name on the
       * focused element is spoken. aria-busy states it outright.
       */
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {pending && <Spinner />}
      {pending ? pendingLabel : children}
    </button>
  );
}
