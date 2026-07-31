"use client";

import Link from "next/link";
import { useState } from "react";

import { SMS_CONSENT_TEXT } from "@/lib/consent";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { QUESTIONS, detectPersona, type Answers } from "@/lib/personas";

import { submitDiagnostic } from "./actions";

/**
 * The diagnostic wizard — the ONLY client component in the application.
 *
 * Everything else is a Server Component. This one earns "use client" because a
 * multi-step form with back/forward and answers held across steps is genuine
 * client state; doing it server-side would mean a round trip per question.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO ENTITY NAMES REACH THIS FILE, BY CONSTRUCTION.
 *
 * It imports lib/personas.ts (questions, persona, reframe copy) and never
 * lib/lead-routing.ts, which holds the entity map and is marked `server-only`.
 * Importing it here would fail the build rather than leak the names into the
 * bundle. The visitor is told "our advisory team" and nothing more.
 *
 * The routing result is computed inside the Server Action, written to
 * leads.routed_entities, and never returned to the browser.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE PERSONA IS COMPUTED TWICE, ON PURPOSE. Here, to choose which reframe copy
 * to show; and again on the server from the validated answers, for the value
 * that is stored. The client's result is never transmitted, so a crafted
 * request cannot select its own routing. detectPersona is pure, so the two
 * agree for any honest submission.
 */

type Step =
  | { kind: "question"; index: number }
  | { kind: "reflect" }
  | { kind: "reframe" }
  | { kind: "capture" }
  | { kind: "done" };

/** Q1–Q3, then the reflect interstitial (step 3.5 in the mockup), then Q4–Q7. */
const REFLECT_AFTER = 3;

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <ol
      aria-label={`Question ${current} of ${total}`}
      className="mb-8 flex items-center gap-2"
    >
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li
            key={n}
            aria-current={state === "current" ? "step" : undefined}
            className={`h-1.5 flex-1 transition-colors ${
              state === "done"
                ? "bg-gold"
                : state === "current"
                  ? "bg-navy"
                  : "bg-gray-200"
            }`}
          >
            <span className="sr-only">
              {state === "done" ? "Completed" : state === "current" ? "Current" : "Upcoming"}{" "}
              question {n}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      className="h-3.5 w-3.5"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

export default function DiagnosticWizard({
  referringSlug,
}: {
  referringSlug?: string;
}) {
  const [step, setStep] = useState<Step>({ kind: "question", index: 0 });
  const [answers, setAnswers] = useState<Answers>({});
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [badFields, setBadFields] = useState<string[]>([]);

  const persona = detectPersona(answers);

  const goToQuestion = (index: number) => {
    // The reflect screen sits between Q3 and Q4 in both directions.
    if (index === REFLECT_AFTER && !("kind" in step && step.kind === "reflect")) {
      setStep({ kind: "reflect" });
      return;
    }
    setStep({ kind: "question", index });
  };

  const answer = (questionId: number, value: string) => {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);

    const index = QUESTIONS.findIndex((q) => q.id === questionId);
    if (index === REFLECT_AFTER - 1) {
      setStep({ kind: "reflect" });
    } else if (index === QUESTIONS.length - 1) {
      setStep({ kind: "reframe" });
    } else {
      setStep({ kind: "question", index: index + 1 });
    }
  };

  const back = () => {
    if (step.kind === "question" && step.index === 0) return;
    if (step.kind === "question") {
      if (step.index === REFLECT_AFTER) setStep({ kind: "reflect" });
      else setStep({ kind: "question", index: step.index - 1 });
    } else if (step.kind === "reflect") {
      setStep({ kind: "question", index: REFLECT_AFTER - 1 });
    } else if (step.kind === "reframe") {
      setStep({ kind: "question", index: QUESTIONS.length - 1 });
    } else if (step.kind === "capture") {
      setStep({ kind: "reframe" });
    }
  };

  async function onSubmit(formData: FormData) {
    setPending(true);
    setFormError(null);
    setBadFields([]);

    const result = await submitDiagnostic({
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      zip: String(formData.get("zip") ?? ""),
      smsConsent: formData.get("smsConsent") === "on",
      website: String(formData.get("website") ?? ""),
      answers: Object.fromEntries(
        Object.entries(answers).map(([k, v]) => [k, String(v)]),
      ),
      referringSlug: referringSlug ?? "",
    });

    setPending(false);
    if (result.ok) setStep({ kind: "done" });
    else {
      setFormError(result.error);
      setBadFields(result.fields ?? []);
    }
  }

  const shell =
    "mx-auto max-w-[720px] border border-gray-200 bg-paper-raised px-10 py-12 max-[700px]:px-6 max-[700px]:py-8";

  /* ---------------------------------------------------------------- QUESTION */
  if (step.kind === "question") {
    const q = QUESTIONS[step.index];
    return (
      <div className={shell}>
        <ProgressDots current={step.index + 1} total={QUESTIONS.length} />
        <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
          {q.eyebrow}
        </p>
        <h2 className="mb-8 font-serif text-[30px] font-semibold leading-[1.2] tracking-[-0.02em] text-navy max-[700px]:text-2xl">
          {q.prompt}
        </h2>

        <ul className="flex flex-col gap-2.5">
          {q.choices.map((c) => {
            const selected = answers[q.id] === c.value;
            return (
              <li key={c.value}>
                <button
                  type="button"
                  onClick={() => answer(q.id, c.value)}
                  aria-pressed={selected}
                  className={`w-full border px-5 py-4 text-left text-base transition-colors ${FOCUS_RING_PAPER} ${
                    selected
                      ? "border-gold bg-gold-pale text-navy"
                      : "border-gray-300 bg-paper text-ink hover:border-gold hover:bg-gold-pale"
                  }`}
                >
                  {c.label}
                </button>
              </li>
            );
          })}
        </ul>

        {step.index > 0 && (
          <button
            type="button"
            onClick={back}
            className={`mt-8 font-mono text-micro uppercase tracking-[0.08em] text-gray-500 transition-colors hover:text-navy ${FOCUS_RING_PAPER}`}
          >
            ← Back
          </button>
        )}
      </div>
    );
  }

  /* ----------------------------------------------------------------- REFLECT */
  if (step.kind === "reflect") {
    return (
      <div className={shell}>
        <ProgressDots current={REFLECT_AFTER} total={QUESTIONS.length} />
        <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
          So far
        </p>
        <h2 className="mb-5 font-serif text-[30px] font-semibold leading-[1.2] tracking-[-0.02em] text-navy max-[700px]:text-2xl">
          Thanks — that helps.
        </h2>
        <p className="mb-8 text-[17px] leading-[1.6] text-gray-700">
          Four quick questions left. They&rsquo;re the ones that usually surface
          something people hadn&rsquo;t considered.
        </p>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => goToQuestion(REFLECT_AFTER)}
            className={`inline-flex items-center gap-2 bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-light ${FOCUS_RING_PAPER}`}
          >
            Continue <ArrowIcon />
          </button>
          <button
            type="button"
            onClick={back}
            className={`font-mono text-micro uppercase tracking-[0.08em] text-gray-500 transition-colors hover:text-navy ${FOCUS_RING_PAPER}`}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- REFRAME */
  if (step.kind === "reframe") {
    return (
      <div className={shell}>
        <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
          What you might be missing
        </p>
        <h2 className="mb-6 font-serif text-[30px] font-semibold leading-[1.2] tracking-[-0.02em] text-navy max-[700px]:text-2xl">
          {persona.headline}
        </h2>
        <div className="mb-8 text-[17px] leading-[1.7] text-gray-700">
          {persona.body.map((p, i) => (
            <p key={i} className="mb-4 last:mb-0">
              {p}
            </p>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setStep({ kind: "capture" })}
            className={`inline-flex items-center gap-2 bg-gold px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-navy-deep transition-colors hover:bg-gold-light ${FOCUS_RING_PAPER}`}
          >
            Talk to an advisor <ArrowIcon />
          </button>
          <button
            type="button"
            onClick={back}
            className={`font-mono text-micro uppercase tracking-[0.08em] text-gray-500 transition-colors hover:text-navy ${FOCUS_RING_PAPER}`}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- CAPTURE */
  if (step.kind === "capture") {
    const bad = (f: string) =>
      badFields.includes(f) ? "border-status-error" : "border-gray-300";

    return (
      <div className={shell}>
        <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
          Free, no commitment
        </p>
        <h2 className="mb-4 font-serif text-[26px] font-semibold leading-[1.25] tracking-[-0.015em] text-navy">
          {persona.captureHeading}
        </h2>
        <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">
          {persona.captureBody}
        </p>

        {formError && (
          <p className="mb-5 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error">
            {formError}
          </p>
        )}

        <form action={onSubmit} className="flex flex-col gap-4">
          {/* Honeypot — off-screen, hidden from assistive tech and keyboard. */}
          <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="d-website">Website</label>
            <input id="d-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
              Your name
            </span>
            <input
              name="name"
              type="text"
              required
              maxLength={100}
              autoComplete="name"
              className={`border bg-white px-3.5 py-2.5 text-base text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10 ${bad("name")}`}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              className={`border bg-white px-3.5 py-2.5 text-base text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10 ${bad("email")}`}
            />
          </label>

          <div className="grid grid-cols-[1fr_140px] gap-4 max-[560px]:grid-cols-1">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
                Phone
              </span>
              <input
                name="phone"
                type="tel"
                required
                maxLength={32}
                autoComplete="tel"
                placeholder="(305) 555-0100"
                className={`border bg-white px-3.5 py-2.5 text-base text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10 ${bad("phone")}`}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
                ZIP <span className="normal-case tracking-normal">(optional)</span>
              </span>
              <input
                name="zip"
                type="text"
                inputMode="numeric"
                maxLength={5}
                autoComplete="postal-code"
                className={`border bg-white px-3.5 py-2.5 text-base text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10 ${bad("zip")}`}
              />
            </label>
          </div>

          {/*
            TCPA consent. The label renders SMS_CONSENT_TEXT — the same constant
            /sms-terms §3 renders and the server action stores — so what is
            shown, published and recorded cannot drift apart.

            NOT `required`, deliberately: /sms-terms §2 says consent "is not a
            condition of receiving advisory services". Making it mandatory would
            contradict the published terms.
          */}
          <label className="mt-1 flex cursor-pointer gap-3 border border-gray-200 bg-paper px-4 py-3.5">
            <input
              name="smsConsent"
              type="checkbox"
              className={`mt-1 h-4 w-4 shrink-0 accent-navy ${FOCUS_RING_PAPER}`}
            />
            <span className="text-xs leading-[1.55] text-gray-700">
              {SMS_CONSENT_TEXT}
            </span>
          </label>

          <button
            type="submit"
            disabled={pending}
            className={`mt-2 bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-light disabled:opacity-60 ${FOCUS_RING_PAPER}`}
          >
            {pending ? "Sending…" : "Request the conversation"}
          </button>

          <p className="text-xs leading-[1.55] text-gray-500">
            We don&rsquo;t sell your details. See our{" "}
            <Link href="/privacy">Privacy Policy</Link> and{" "}
            <Link href="/sms-terms">SMS Terms</Link>.
          </p>
        </form>

        <button
          type="button"
          onClick={back}
          className={`mt-6 font-mono text-micro uppercase tracking-[0.08em] text-gray-500 transition-colors hover:text-navy ${FOCUS_RING_PAPER}`}
        >
          ← Back
        </button>
      </div>
    );
  }

  /* -------------------------------------------------------------------- DONE */
  return (
    <div className={shell}>
      <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
        Received
      </p>
      <h2 className="mb-5 font-serif text-[30px] font-semibold leading-[1.2] tracking-[-0.02em] text-navy">
        Thank you — we&rsquo;ll be in touch.
      </h2>
      <p className="mb-4 text-[17px] leading-[1.6] text-gray-700">
        A member of our advisory team will reach out within one business day.
        There&rsquo;s no obligation, and the conversation is free.
      </p>
      <p className="text-note leading-[1.6] text-gray-500">
        In the meantime, it&rsquo;s worth{" "}
        <Link href="/verify">verifying any contractor&rsquo;s license</Link> and
        reading the <Link href="/hiring-checklist">hiring checklist</Link>.
      </p>
    </div>
  );
}
