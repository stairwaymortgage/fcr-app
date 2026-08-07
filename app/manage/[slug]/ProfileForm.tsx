"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import { Spinner } from "@/components/SubmitButton";
import { FOCUS_RING_PAPER } from "@/lib/focus";

import { saveProfile } from "./actions";
import { EMPTY_SAVE_STATE, type EditableValues } from "./save-state";

/**
 * The editable half of /manage/[slug].
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONLY CLIENT COMPONENT ON THIS PAGE, AND IT EARNS IT TWICE.
 *
 * The page shell, the locked licence card and the whole preview pane are server
 * components. This is client for two reasons that a plain form genuinely cannot
 * cover:
 *
 *   1. A REJECTED SAVE MUST NOT EMPTY THE FORM. Without useFormState a failed
 *      Server Action can only report itself by redirecting, and a redirect
 *      re-renders from saved state — so a contractor who mistypes a website
 *      loses the twelve hundred characters of About text they just wrote. That
 *      is a worse outcome than the validation error it is reporting.
 *
 *   2. The character counter is the difference between seeing "1200 limit" and
 *      being told about it after pressing Save.
 *
 * Everything else stayed on the server. There is no autosave, no live preview
 * wiring, and no state shared with the pane on the right — by decision, and
 * because none of it would survive a page reload anyway.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NO CLIENT-SIDE VALIDATION MIRRORS THE RPC. The limits below are maxLength
 * attributes and a counter, which are hints; the refusal happens in
 * update_own_contractor_profile(). Duplicating the rules in TypeScript would
 * create two places to change them and one of them would drift.
 */

const ABOUT_LIMIT = 1200;

export type SavedProfile = {
  dbprSyncKey: string;
  slug: string;
  about: string;
  website: string;
  email: string;
  phone: string;
  serviceArea: string;
};

export default function ProfileForm({ saved }: { saved: SavedProfile }) {
  const [state, formAction] = useFormState(saveProfile, EMPTY_SAVE_STATE);

  /**
   * Where each field starts: what was typed on a failed save, otherwise what is
   * in the database. `values` is only ever set on failure, so a successful save
   * falls back to `saved`, which the action has just revalidated.
   */
  const start: EditableValues = state.values ?? {
    about: saved.about,
    website: saved.website,
    email: saved.email,
    phone: saved.phone,
    serviceArea: saved.serviceArea,
  };

  const [about, setAbout] = useState(start.about);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="dbpr_sync_key" value={saved.dbprSyncKey} />
      <input type="hidden" name="slug" value={saved.slug} />

      {state.error && (
        <p
          role="alert"
          className="border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error"
        >
          {state.error}
        </p>
      )}
      {state.ok && (
        <p
          role="status"
          className="border-l-[3px] border-status-success bg-status-successBg px-4 py-3 text-note text-status-success"
        >
          Saved. Your public profile has been updated.
        </p>
      )}

      <Card title="About your business">
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">About your business</span>
          <textarea
            name="about"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            maxLength={ABOUT_LIMIT}
            rows={9}
            placeholder="What your business does, where you work, how long you have been at it."
            className={`w-full border border-gray-300 bg-white px-3.5 py-2.5 text-[15px] leading-[1.6] text-ink focus:border-navy focus:outline-none ${FOCUS_RING_PAPER}`}
          />
        </label>
        <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-gray-100 pt-3">
          <p className="text-note leading-[1.6] text-gray-600">
            Specific details about your work, your area and your years of
            experience help homeowners decide.
          </p>
          <span
            className="shrink-0 font-mono text-label tabular-nums text-gray-500"
            aria-live="polite"
          >
            {about.length} / {ABOUT_LIMIT}
          </span>
        </div>
      </Card>

      <Card title="Public contact information">
        <Field label="Website" hint="Must start with http:// or https://">
          <input
            name="website"
            type="text"
            inputMode="url"
            defaultValue={start.website}
            maxLength={300}
            placeholder="https://www.example.com"
            className={inputClass}
          />
        </Field>
        <Field label="Public email">
          <input
            name="email"
            type="email"
            defaultValue={start.email}
            maxLength={254}
            placeholder="info@example.com"
            className={inputClass}
          />
        </Field>
        <Field label="Public phone">
          <input
            name="phone"
            type="tel"
            defaultValue={start.phone}
            maxLength={32}
            placeholder="(954) 555-0143"
            className={inputClass}
          />
        </Field>
        <Field label="Service area" hint="Free text — the counties or towns you cover.">
          <input
            name="service_area"
            type="text"
            defaultValue={start.serviceArea}
            maxLength={200}
            placeholder="Broward County, South Florida"
            className={inputClass}
          />
        </Field>
        <p className="mt-3 border-t border-gray-100 pt-3 text-note leading-[1.6] text-gray-600">
          This is what homeowners see on your public profile. Leave a field empty
          to remove it.
        </p>
      </Card>

      <Actions slug={saved.slug} />
    </form>
  );
}

const inputClass =
  "w-full border border-gray-300 bg-white px-3.5 py-2.5 text-[15px] text-ink " +
  "focus:border-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-gold " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

/**
 * Save and Discard.
 *
 * Its own component because useFormStatus only reports the status of the form
 * ABOVE it in the tree — called in ProfileForm itself it would always read
 * false, which is the standard trap with that hook.
 *
 * Discard is a plain anchor, not a button and not a next/link. A full document
 * request re-renders the page from the database, which IS the discard: no reset
 * handler to keep in step with the fields, and it behaves identically with
 * JavaScript switched off.
 */
function Actions({ slug }: { slug: string }) {
  const { pending } = useFormStatus();

  return (
    <div className="flex items-center justify-between gap-4 border border-gray-200 bg-paper-raised px-5 py-4">
      <p className="text-note text-gray-600">
        Changes are published when you save.
      </p>
      <div className="flex items-center gap-3">
        <a
          href={`/manage/${slug}`}
          className={`border border-gray-300 bg-white px-5 py-3 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-gray-700 transition-colors hover:border-navy hover:text-navy ${FOCUS_RING_PAPER}`}
        >
          Discard
        </a>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className={`inline-flex items-center justify-center gap-2 bg-navy px-6 py-3 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-deep disabled:opacity-60 ${FOCUS_RING_PAPER}`}
        >
          {pending && <Spinner />}
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-gray-200 bg-white">
      <h2 className="border-b border-gray-200 px-6 py-4 font-mono text-label font-semibold uppercase tracking-label text-gold">
        {title}
      </h2>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 border-b border-gray-100 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <span className="font-mono text-label font-medium uppercase tracking-[0.06em] text-gray-500">
        {label}
      </span>
      {children}
      {hint && <span className="text-note text-gray-500">{hint}</span>}
    </label>
  );
}
