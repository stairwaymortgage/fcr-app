/**
 * Contractor logo — shared definitions.
 *
 * Imported by the manage page, the uploader (a Client Component) and the server
 * action, so the three cannot drift. Deliberately free of "server-only" and of
 * any Supabase import, for the same reason lib/claims.ts is: the uploader runs
 * in the browser and needs the same limits the server enforces.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTHING IN THIS FILE IS A CONTROL.
 *
 * Every limit here is a courtesy — a message a contractor can act on before a
 * 2 MB upload fails. The real refusals live in two places that a caller
 * bypassing the form still hits:
 *
 *   · the bucket's own file_size_limit and allowed_mime_types, which apply to
 *     the signed upload regardless of what the browser believes;
 *   · assert_own_photo_path(), which re-derives the folder from the session's
 *     own profile and re-checks the extension before any path is recorded.
 *
 * Keep them in sync with db/migrations/20260804_contractor_logo.sql. If they
 * drift, this file is the one that is wrong.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const LOGO_BUCKET = "contractor-logos";

/** Mirrors the bucket's file_size_limit. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Mirrors the bucket's allowed_mime_types.
 *
 * NO SVG, though manage_profile.html:766 says "PNG, JPG, or SVG". An SVG is a
 * script carrier and this renders inline on a public page beside a "Verified"
 * badge. The mockup's caption is wrong; LOGO_ACCEPT_LABEL is the corrected copy.
 *
 * NO HEIC, though the id-photos bucket allows it. That one is opened by a single
 * reviewer in a dashboard; this one goes straight into an <img> for the public,
 * and Chrome and Firefox do not render HEIC — the profile would look right to
 * the contractor on their iPhone and broken to most of the internet.
 */
export const LOGO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const LOGO_ACCEPT = LOGO_MIME_TYPES.join(",");
export const LOGO_ACCEPT_LABEL = "JPG · PNG · WEBP · Max 2 MB";

/**
 * Extension per MIME type, for the stored filename.
 *
 * Derived from the browser-reported type and never from the uploaded filename:
 * a filename is attacker-controlled and "logo.jpg.svg" is a real trick. Same
 * rule as ID_PHOTO_EXTENSIONS.
 */
export const LOGO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Why a file was refused, in a sentence the contractor can act on.
 *
 * HEIC GETS ITS OWN MESSAGE, and that is the point of this function existing
 * rather than one generic string. An iPhone photo library sends HEIC in the
 * cases where iOS does not transcode, and "that file type isn't accepted" tells
 * someone holding the only copy of their logo nothing about what to do next.
 * Returns null when the file is acceptable.
 */
export function describeLogoProblem(file: { type: string; size: number }): string | null {
  if (file.type === "image/heic" || file.type === "image/heif") {
    return (
      "That's a HEIC photo — iPhone's default format, which most browsers can't " +
      "display. Open it in Photos, choose Export or Duplicate, and save it as a " +
      "JPEG first."
    );
  }
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "That file type isn't accepted. Use a JPG, PNG or WEBP image.";
  }
  if (file.size > LOGO_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `That image is ${mb} MB. The limit is 2 MB — try exporting it smaller.`;
  }
  return null;
}

/**
 * The public URL for a stored logo path.
 *
 * BUILT FROM THE ENV VAR RATHER THAN supabase.storage.getPublicUrl(), so that a
 * Server Component can render an <img> without constructing a Supabase client
 * for a string concatenation. The shape is Supabase's documented public-object
 * route and changes only if the project moves.
 *
 * Returns null when there is no logo, so callers branch on the value rather than
 * rendering an <img> with an empty src — which browsers resolve against the
 * current page and re-request, hitting the server a second time for the HTML.
 */
export function logoPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${LOGO_BUCKET}/${path}`;
}

/**
 * "Aceca Construction" -> "A". The placeholder the mockup shows in the 140x140
 * zone (manage_profile.html:763) is a single serif capital, not two initials —
 * verified against .photo-current and .mini-profile-logo, both of which render
 * exactly one character.
 */
export function logoInitial(name: string): string {
  const first = name.trim().match(/[A-Za-z0-9]/);
  return first ? first[0].toUpperCase() : "?";
}
