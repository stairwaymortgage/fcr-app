/**
 * Claim flow — shared definitions.
 *
 * Imported by the page, the client form and the server action, so the three
 * cannot drift. Deliberately free of "server-only" and of any Supabase import:
 * the form is a Client Component and needs the same limits the server enforces.
 */

export const ID_PHOTO_BUCKET = "id-photos";

/**
 * MUST STAY IN SYNC WITH THE BUCKET, which is the real enforcement.
 * db/migrations/20260801_claim_id_photos_storage.sql sets file_size_limit and
 * allowed_mime_types on the bucket itself; these constants only let us fail
 * early with a sentence a contractor can act on, instead of surfacing a raw
 * storage error after a 10 MB upload has already been sent.
 *
 * NO PDF, though the mockup's caption says "JPG · PNG · PDF". A PDF is a
 * container format that can carry JavaScript and embedded files, and the bucket
 * refuses it. The caption is wrong, not the bucket — see ID_PHOTO_ACCEPT_LABEL.
 */
export const ID_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export const ID_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** For the file input's accept attribute. */
export const ID_PHOTO_ACCEPT = ID_PHOTO_MIME_TYPES.join(",");
export const ID_PHOTO_ACCEPT_LABEL = "JPG · PNG · HEIC · WEBP · Max 10MB";

/**
 * Extension per MIME type. The stored path ends in a real extension so that
 * whoever opens the file in the Supabase dashboard gets a preview rather than a
 * download of unknown bytes — Jim reviews there, and an extensionless blob is a
 * meaningfully worse review experience.
 *
 * Derived from the browser-reported type, never from the uploaded filename: a
 * filename is attacker-controlled and "licence.jpg.svg" is a real trick.
 */
export const ID_PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export const CLAIM_ROLES = [
  { value: "qualifying_agent", label: "Qualifying Agent (license holder)" },
  { value: "owner_officer", label: "Owner / Officer" },
  { value: "authorized_rep", label: "Authorized Representative" },
] as const;

export type ClaimRole = (typeof CLAIM_ROLES)[number]["value"];

export const CLAIM_ROLE_VALUES = CLAIM_ROLES.map((r) => r.value) as readonly string[];

/**
 * THE ATTESTATION IS ONE CONSTANT, RENDERED AND STORED FROM THE SAME BYTES.
 *
 * Same reasoning as SMS_CONSENT_TEXT in lib/consent.ts: a stored consent record
 * is only evidence if it is provably the text the person saw. If the form
 * rendered one sentence and the database recorded another, the record is worse
 * than useless — it looks like proof while proving nothing.
 *
 * The business name is interpolated because the mockup names the business in
 * the sentence, and a generic attestation is materially weaker: "I am an
 * authorized representative" is not the same assertion as naming the company.
 */
export function attestationText(businessName: string): string {
  return (
    `I confirm that I am the qualifying agent or an authorized representative of ` +
    `${businessName}, and the information I provided is accurate. I understand ` +
    `that submitting false information may result in permanent removal from the ` +
    `registry. I agree to the Terms of Service and Privacy Policy. My government ` +
    `ID will be reviewed by Florida Contractor Registry staff and will not be ` +
    `published, sold, or shared.`
  );
}

export const CLAIM_LIMITS = {
  name: { min: 2, max: 100 },
  email: { max: 254 },
  phone: { min: 7, max: 32 },
  description: { max: 1000 },
  website: { max: 300 },
} as const;

/**
 * Why a claim page refuses to show its form. Kept as data so the page renders
 * one explanation per case instead of a generic "unavailable", and so the
 * server action can reject with the same vocabulary the page displays.
 */
/**
 * Normalise an embedded PostgREST relation to a single row.
 *
 * `select("..., contractors(...)")` is typed as an ARRAY even when the foreign
 * key guarantees at most one row, because PostgREST cannot express that in the
 * generated types. Casting straight to an object compiles only with a double
 * assertion through `unknown`, which would silence a genuinely wrong shape too.
 * This narrows honestly and returns null rather than throwing on an empty
 * embed — a claim whose contractor row was deleted should render a degraded
 * page, not a 500.
 */
export function oneRelation<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

export type ClaimBlockedReason =
  | "already_claimed_by_you"
  | "already_claimed_by_other"
  | "pending_by_you"
  | "rejected_recently";
