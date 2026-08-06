"use client";

import { useRef, useState } from "react";

import {
  CLAIM_ROLES,
  ID_PHOTO_ACCEPT,
  ID_PHOTO_ACCEPT_LABEL,
  ID_PHOTO_BUCKET,
  ID_PHOTO_MAX_BYTES,
  ID_PHOTO_MIME_TYPES,
} from "@/lib/claims";
import { Spinner } from "@/components/SubmitButton";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { createClient } from "@/lib/supabase/client";

import { createIdPhotoUploadTarget, submitClaim } from "./actions";

/**
 * The claim form. A Client Component, unlike the rest of the public site,
 * because the ID photo has to reach storage without passing through a Server
 * Action — action bodies are capped at 1 MB by default and a phone photo of a
 * driving licence is routinely 3-8 MB. It would fail as a body-size error that
 * reads like a bug rather than a limit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FILE GOES BROWSER → STORAGE. THE FORM POSTS ONLY THE CLAIM ID.
 *
 *   1. createIdPhotoUploadTarget() — server builds the path from the session's
 *      own user id and mints a one-shot token. The path is never chosen here.
 *   2. uploadToSignedUrl() — the bytes go straight to the private bucket.
 *   3. submitClaim() — posts the claim id; the server finds the object by
 *      listing that user's own folder.
 *
 * So no part of the storage path is client-controlled, and the bucket's own
 * MIME and size limits still apply to the upload in step 2 regardless of what
 * this component believes about the file.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The checks below are a COURTESY, not a control. Every one of them is
 * re-applied in actions.ts, which is what a caller bypassing this form hits.
 */
export default function ClaimForm({
  slug,
  syncKey,
  licenseNumber,
  businessName,
  defaultEmail,
  attestation,
}: {
  slug: string;
  syncKey: string;
  licenseNumber: string;
  businessName: string;
  defaultEmail: string;
  attestation: string;
}) {
  const [claimId, setClaimId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setClaimId(null);
    setFileName(null);

    if (!(ID_PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
      setUploadError("That file type isn't accepted. Use a JPG, PNG, HEIC or WEBP photo.");
      return;
    }
    if (file.size > ID_PHOTO_MAX_BYTES) {
      setUploadError("That photo is larger than 10MB. Try again with a smaller image.");
      return;
    }

    setUploading(true);
    try {
      const target = await createIdPhotoUploadTarget({
        slug,
        syncKey,
        mimeType: file.type,
        size: file.size,
      });

      if (!target.ok) {
        setUploadError(target.error);
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.storage
        .from(ID_PHOTO_BUCKET)
        .uploadToSignedUrl(target.path, target.token, file, {
          contentType: file.type,
        });

      if (error) {
        // The bucket refusing the file lands here — the limits it enforces are
        // the real ones, so its complaint is worth showing rather than hiding.
        console.error("[claim] upload failed", error.message);
        setUploadError("That photo couldn't be uploaded. Please try a different file.");
        return;
      }

      setClaimId(target.claimId);
      setFileName(file.name);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      action={async (formData) => {
        setSubmitting(true);
        await submitClaim(formData);
        // No setSubmitting(false): the action always redirects, so reaching
        // here means the navigation is already under way.
      }}
      className="flex flex-col gap-8"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="contractor_dbpr_sync_key" value={syncKey} />
      <input type="hidden" name="claim_id" value={claimId ?? ""} />

      {/* Honeypot — off-screen, hidden from assistive tech and keyboard. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="c-website-hp">Website</label>
        <input id="c-website-hp" name="website_hp" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <fieldset className="flex flex-col gap-4 border border-gray-200 bg-paper-raised px-6 py-6 max-[700px]:px-4">
        <legend className="px-2 font-serif text-[20px] font-semibold text-navy">
          Confirm your identity
        </legend>
        <p className="text-note leading-[1.6] text-gray-700">
          These details should match the qualifying agent on file with the Florida
          Department of Business and Professional Regulation.
        </p>

        <Field label="License number — from this profile">
          <input
            type="text"
            value={licenseNumber}
            readOnly
            className="w-full border border-gray-200 bg-gray-100 px-3.5 py-2.5 font-mono text-base text-gray-600"
          />
        </Field>

        <Field label="Your full legal name *">
          <input
            name="claimant_name"
            type="text"
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
            placeholder="As shown on government ID"
            className={INPUT}
          />
        </Field>

        <Field label="Role at the business *">
          <select name="claimant_role" required defaultValue="" className={INPUT}>
            <option value="" disabled>
              Select your role…
            </option>
            {CLAIM_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Email address *">
          <input
            name="claimant_email"
            type="email"
            required
            maxLength={254}
            defaultValue={defaultEmail}
            autoComplete="email"
            className={INPUT}
          />
        </Field>

        <Field label="Phone number *">
          <input
            name="claimant_phone"
            type="tel"
            required
            maxLength={32}
            autoComplete="tel"
            placeholder="(954) 555-0123"
            className={INPUT}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3 border border-gray-200 bg-paper-raised px-6 py-6 max-[700px]:px-4">
        <legend className="px-2 font-serif text-[20px] font-semibold text-navy">
          Upload government ID
        </legend>
        <p className="text-note leading-[1.6] text-gray-700">
          A clear photo of your driver&rsquo;s license or state-issued ID. The name must
          match the qualifying agent on file with DBPR. Reviewed manually and{" "}
          <strong>never published</strong> on the site.
        </p>

        <input
          ref={fileRef}
          id="id-photo"
          type="file"
          accept={ID_PHOTO_ACCEPT}
          onChange={onFileChange}
          className="block w-full text-note file:mr-4 file:border file:border-navy file:bg-navy file:px-4 file:py-2 file:font-mono file:text-label file:uppercase file:tracking-label file:text-paper"
        />
        <p className="font-mono text-micro uppercase tracking-label text-gray-500">
          {ID_PHOTO_ACCEPT_LABEL}
        </p>

        {uploading && (
          <p role="status" className="text-note text-gray-700">
            Uploading your ID…
          </p>
        )}
        {claimId && fileName && (
          <p role="status" className="text-note text-status-success">
            ✓ {fileName} uploaded and stored privately.
          </p>
        )}
        {uploadError && (
          <p role="alert" className="text-note text-status-error">
            {uploadError}
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4 border border-gray-200 bg-paper-raised px-6 py-6 max-[700px]:px-4">
        <legend className="px-2 font-serif text-[20px] font-semibold text-navy">
          About your business <span className="text-gray-500">(optional)</span>
        </legend>

        <Field label="Business description — 1–3 sentences">
          <textarea
            name="business_description"
            rows={4}
            maxLength={1000}
            placeholder={`E.g. ${businessName} is a full-service general contractor serving Broward County, specializing in residential remodels, additions, and roofing.`}
            className={INPUT}
          />
        </Field>

        <Field label="Business website — optional">
          <input
            name="business_website"
            type="url"
            maxLength={300}
            placeholder="https://yourcompany.com"
            className={INPUT}
          />
        </Field>
        <p className="text-micro leading-[1.6] text-gray-600">
          These are saved with your claim and applied to your profile once it&rsquo;s
          approved — not before.
        </p>
      </fieldset>

      <div className="flex flex-col gap-3">
        {/*
          The attestation text is passed in from the server and rendered here
          verbatim, so what the claimant reads is byte-identical to what gets
          stored on the claim row. See lib/claims.ts.
        */}
        <label className="flex items-start gap-3 text-note leading-[1.6] text-gray-700">
          <input name="attest" type="checkbox" required className="mt-1 shrink-0" />
          <span>{attestation}</span>
        </label>

        <label className="flex items-start gap-3 text-note leading-[1.6] text-gray-700">
          <input name="terms" type="checkbox" required className="mt-1 shrink-0" />
          <span>
            I agree to the <a href="/terms">Terms of Service</a> and{" "}
            <a href="/privacy">Privacy Policy</a>.
          </span>
        </label>

        <label className="flex items-start gap-3 text-note leading-[1.6] text-gray-700">
          <input name="marketing" type="checkbox" className="mt-1 shrink-0" />
          <span>
            I&rsquo;d like occasional emails about contractor resources and registry
            updates. <span className="text-gray-500">(Optional)</span>
          </span>
        </label>
      </div>

      <div>
        <button
          type="submit"
          disabled={!claimId || uploading || submitting}
          aria-busy={submitting || undefined}
          className={`inline-flex w-full items-center justify-center gap-2 bg-navy px-6 py-4 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-light disabled:opacity-50 ${FOCUS_RING_PAPER}`}
        >
          {submitting && <Spinner />}
          {submitting ? "Submitting…" : "Submit for verification →"}
        </button>
        {!claimId && (
          <p className="mt-2 text-center text-micro text-gray-600">
            Upload your ID photo to enable submission.
          </p>
        )}
        <p className="mt-3 text-center text-micro leading-[1.6] text-gray-600">
          Manual review takes 24&ndash;48 hours. You&rsquo;ll receive an email when your
          claim is approved.
        </p>
      </div>
    </form>
  );
}

const INPUT =
  "w-full border border-gray-300 bg-white px-3.5 py-2.5 text-base text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}
