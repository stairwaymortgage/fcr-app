"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { FOCUS_RING_PAPER } from "@/lib/focus";
import {
  LOGO_ACCEPT,
  LOGO_ACCEPT_LABEL,
  LOGO_BUCKET,
  describeLogoProblem,
  logoInitial,
  logoPublicUrl,
} from "@/lib/logo";
import { createClient } from "@/lib/supabase/client";

import { clearLogo, createLogoUploadTarget, saveUploadedLogo } from "./actions";

/**
 * The "Business Photo or Logo" section of /manage/[slug].
 * Source: _handoff/02_mockups_production/04_contractor_facing/manage_profile.html:756-771
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SECOND CLIENT COMPONENT ON THIS PAGE, AND IT EARNS IT THE SAME WAY
 * ClaimForm DOES: the bytes must reach storage without passing through a Server
 * Action. Action bodies are capped at 1 MB by default and the bucket accepts
 * 2 MB, so half the allowed range would fail as a body-size error that reads
 * like a bug rather than a limit.
 *
 * The upload goes browser → bucket against a one-shot signed URL the server
 * mints. See the docblock over createLogoUploadTarget() in ./actions.ts for why
 * that is also the ownership boundary.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE CHECKS HERE ARE A COURTESY, NOT A CONTROL — the same sentence
 * ClaimForm.tsx carries, and just as true. Every one is re-applied by
 * createLogoUploadTarget(), by the bucket's own limits, and by
 * assert_own_photo_path() inside the database. What they buy is a message
 * before a 2 MB upload rather than after it.
 *
 * ONE INTERACTION, NOT TWO. Choosing a file uploads it and saves it. The mockup
 * shows a single "Upload File" button and no Save beside it, which is also the
 * right behaviour: a picked-but-unsaved image is a state a contractor cannot see
 * and would reasonably assume was already applied.
 *
 * NO CROPPER, NO PREVIEW-BEFORE-SAVE, NO DRAG-AND-DROP. None appear in the
 * mockup. The mockup's own guidance — square, at least 400x400 — is rendered as
 * text; enforcing it would mean rejecting a logo that is merely not square,
 * which is worse than displaying one that is not.
 */

export interface LogoUploaderProps {
  dbprSyncKey: string;
  /** Display name, for the placeholder letter and the alt text. */
  businessName: string;
  /** Stored path, not a URL. Null when no logo has been uploaded. */
  currentPath: string | null;
}

export default function LogoUploader({
  dbprSyncKey,
  businessName,
  currentPath,
}: LogoUploaderProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentUrl = logoPublicUrl(currentPath);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    const problem = describeLogoProblem(file);
    if (problem) {
      setError(problem);
      // Cleared so that picking the SAME file again still fires onChange —
      // otherwise a contractor who fixes nothing and retries gets no feedback
      // at all, which reads as the button being broken.
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    try {
      const target = await createLogoUploadTarget({
        syncKey: dbprSyncKey,
        mimeType: file.type,
        size: file.size,
      });

      if (!target.ok) {
        setError(target.error);
        return;
      }

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .uploadToSignedUrl(target.path, target.token, file, {
          contentType: file.type,
        });

      if (uploadError) {
        // The bucket refusing the file lands here, and its limits are the real
        // ones — but its message is written for an operator, so it is logged
        // rather than shown.
        console.error("[manage] logo upload failed", uploadError.message);
        setError("That image couldn't be uploaded. Please try a different file.");
        return;
      }

      const saved = await saveUploadedLogo({ syncKey: dbprSyncKey, path: target.path });
      if (!saved.ok) {
        setError(saved.error ?? "That didn't save. Please try again.");
        return;
      }

      // The server action revalidated both paths; this is what makes the new
      // image appear without a manual reload.
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
        <h2 className="font-mono text-label font-semibold uppercase tracking-label text-gold">
          Business photo or logo
        </h2>
        <span className="font-mono text-label uppercase tracking-label text-gray-500">
          {LOGO_ACCEPT_LABEL}
        </span>
      </div>

      <div className="grid grid-cols-[140px_1fr] items-center gap-5 px-6 py-6 max-[520px]:grid-cols-1">
        {/* The 140x140 zone. Gold hairline inset 6px, matching .photo-current. */}
        <div className="relative h-[140px] w-[140px] shrink-0 bg-gradient-to-br from-navy to-navy-deep">
          {currentUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element --
               Deliberate, and the same call /admin/claims made for its ID
               photos: next/image would route this through Vercel's optimizer,
               adding a second cache in front of an image the contractor expects
               to be able to replace and have gone. A plain <img> is served by
               the bucket's own CDN and nothing else persists it. */
            <img
              src={currentUrl}
              alt={`${businessName} logo`}
              className="h-full w-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-full w-full items-center justify-center font-serif text-[56px] font-bold italic text-gold"
            >
              {logoInitial(businessName)}
            </span>
          )}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-1.5 border border-gold"
          />
        </div>

        <div>
          <p className="mb-2.5 text-ui leading-[1.65] text-gray-700">
            {currentUrl ? (
              <>
                <strong className="font-semibold text-ink">
                  This is what homeowners see.
                </strong>{" "}
                It appears beside your business name on your public profile.
              </>
            ) : (
              <>
                <strong className="font-semibold text-ink">
                  Currently using a placeholder.
                </strong>{" "}
                Upload your company logo or a professional photo to replace it on
                your public profile.
              </>
            )}
          </p>
          <p className="mb-3.5 text-ui leading-[1.65] text-gray-700">
            JPG, PNG or WEBP · Max 2 MB · Square works best (at least 400×400px)
          </p>

          {error && (
            <p
              role="alert"
              className="mb-3.5 border-l-[3px] border-status-error bg-status-errorBg px-3 py-2 text-note leading-[1.5] text-status-error"
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {/*
              A LABEL, NOT A BUTTON WRAPPING AN INPUT. Clicking a <label> that
              points at a file input opens the picker natively, so this needs no
              onClick and keeps working with the keyboard. The input itself is
              visually hidden rather than display:none — the latter takes it out
              of the tab order in some browsers, which would strand a
              keyboard-only contractor with no way to reach it.
            */}
            <label
              className={`inline-block cursor-pointer border border-gray-300 bg-white px-4 py-2.5 font-mono text-label uppercase tracking-label text-gray-700 transition-colors hover:border-navy hover:text-navy focus-within:border-navy ${
                busy ? "pointer-events-none opacity-60" : ""
              }`}
            >
              {busy ? "Uploading…" : currentUrl ? "Replace file" : "Upload file"}
              <input
                ref={inputRef}
                type="file"
                accept={LOGO_ACCEPT}
                disabled={busy}
                onChange={onFileChange}
                className="sr-only"
              />
            </label>

            {currentPath && (
              /* A plain form, so removing a logo works with JS disabled. The
                 action reads the sync key from the body and re-checks ownership
                 server-side; nothing here is trusted. */
              <form action={clearLogo}>
                <input type="hidden" name="dbpr_sync_key" value={dbprSyncKey} />
                <button
                  type="submit"
                  disabled={busy}
                  className={`border border-gray-300 bg-white px-4 py-2.5 font-mono text-label uppercase tracking-label text-gray-700 transition-colors hover:border-status-error hover:text-status-error disabled:opacity-60 ${FOCUS_RING_PAPER}`}
                >
                  Remove
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
