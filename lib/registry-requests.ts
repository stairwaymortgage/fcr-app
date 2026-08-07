/**
 * Registry request — field definitions and validation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PURE, AND DEPENDENCY-FREE, SO IT CAN BE TESTED. SAME MOVE AS safe-next.ts
 * AND email-copy.ts.
 *
 * app/join/actions.ts is a Server Action: it reads the request, the service-role
 * client and the rate limiter, none of which a plain node script can stand up.
 * The part actually worth testing — what the form accepts and what it refuses —
 * therefore lives here, in a module with no `server-only`, no next/headers, no
 * env, no network and no third-party import. scripts/verify-join-flow.mjs runs
 * it offline in milliseconds.
 *
 * ⚠ NO zod HERE, DELIBERATELY, even though the diagnostic action uses it. The
 * point of this module is that `node --experimental-strip-types` can load it
 * with nothing installed. Adding a runtime dependency would quietly take that
 * away and the loss would only show up when the test stopped running.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ THIS IS THE ONLY VALIDATION THAT EXISTS. A Server Action is a public POST
 * endpoint with a stable id, so `required`, `maxLength` and `type="email"` on
 * the form are courtesies for real people and guarantee nothing about what
 * arrives. Everything the action writes passes through validateRegistryRequest.
 */

/**
 * Trade options.
 *
 * ⚠ NOT THE DBPR LICENCE-TYPE LIST, AND THAT IS THE POINT. The reference table
 * holds codes like CGC and CCC that a business without a DBPR record has no
 * reason to know — and not knowing is the definition of the person filling in
 * this form. These are plain-English trades, and the admin maps one to a real
 * licence type by hand when they create the listing.
 *
 * `other` exists so the field can stay optional-but-useful rather than forcing
 * a wrong answer. The notes field is where an unusual trade gets explained.
 */
export const TRADES = [
  { value: "general_contractor", label: "General contractor" },
  { value: "roofing", label: "Roofing" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "hvac", label: "HVAC / air conditioning" },
  { value: "pool", label: "Pool / spa" },
  { value: "solar", label: "Solar" },
  { value: "concrete", label: "Concrete / masonry" },
  { value: "remodeling", label: "Remodeling / build-out" },
  { value: "landscaping", label: "Landscaping / irrigation" },
  { value: "other", label: "Something else" },
] as const;

export type TradeValue = (typeof TRADES)[number]["value"];

const TRADE_VALUES = new Set<string>(TRADES.map((t) => t.value));

export function tradeLabel(value: string | null): string | null {
  if (!value) return null;
  return TRADES.find((t) => t.value === value)?.label ?? value;
}

/**
 * Field ceilings. Mirrored on the inputs as maxLength so a real person is
 * stopped by the browser rather than by a refusal after they hit send — but
 * enforced HERE, which is the copy that counts.
 */
export const LIMITS = {
  businessName: 200,
  email: 254,
  licenseNumber: 50,
  county: 100,
  contactName: 100,
  phone: 32,
  website: 500,
  notes: 2000,
} as const;

export interface RegistryRequestInput {
  businessName: string;
  email: string;
  licenseNumber: string;
  trade: string;
  county: string;
  contactName: string;
  phone: string;
  website: string;
  notes: string;
  /** Honeypot. Bots fill it; people cannot see it. */
  companyUrl: string;
}

export interface RegistryRequestValues {
  business_name: string;
  email: string;
  license_number: string | null;
  trade: string | null;
  county: string | null;
  contact_name: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
}

export type ValidationResult =
  | { ok: true; values: RegistryRequestValues }
  | { ok: false; fields: string[] };

/**
 * Deliberately loose, and it is the same shape the rest of the app uses.
 *
 * A stricter pattern rejects real addresses (new TLDs, plus-addressing, quoted
 * local parts) and buys nothing: the only proof an address works is that mail
 * to it arrives, and this queue sends exactly one confirmation. A typo'd address
 * costs a bounce. A rejected valid address costs a listing.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Blank optional field -> NULL, never "". See the note in the migration. */
function orNull(value: string, max: number): string | null {
  const trimmed = value.trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
}

/**
 * Normalise a typed website to an absolute URL.
 *
 * ACCEPTS A BARE DOMAIN, unlike the claim form, which requires the visitor to
 * type the scheme. "gulfcoastroofing.com" is what a business owner types and
 * refusing it is friction with no security value — the value is stored, shown
 * to one admin, and never fetched or rendered as a link on a public page.
 *
 * javascript:, data: and every other scheme are rejected rather than coerced:
 * this string ends up in an href on the admin page, and the one thing that must
 * not happen is a reviewer clicking a request and running someone's script.
 */
export function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (candidate.length > LIMITS.website) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A hostname with no dot is not a public site — "localhost", "intranet", or a
  // typo. Storing it would send the reviewer somewhere on their own machine.
  if (!url.hostname.includes(".")) return null;

  return url.toString();
}

/**
 * Validate one submission.
 *
 * Returns EVERY bad field rather than the first, so someone who mistyped two
 * things is told both at once instead of discovering them one send at a time.
 * The honeypot is reported as `spam` and is the caller's cue to return a
 * generic failure — a bot must not learn which field gave it away.
 */
export function validateRegistryRequest(input: RegistryRequestInput): ValidationResult {
  if (input.companyUrl.trim() !== "") return { ok: false, fields: ["spam"] };

  const fields: string[] = [];

  const businessName = input.businessName.trim().slice(0, LIMITS.businessName);
  if (businessName.length < 2) fields.push("business_name");

  const email = input.email.trim().toLowerCase().slice(0, LIMITS.email);
  if (!EMAIL_SHAPE.test(email)) fields.push("email");

  /**
   * Trade is optional, but a value that is not on the list is an error rather
   * than a silent drop. A <select> cannot produce one, so anything else is a
   * crafted request or a stale cached client — and quietly storing it would put
   * an unrenderable value in front of the reviewer.
   */
  const trade = input.trade.trim();
  if (trade !== "" && !TRADE_VALUES.has(trade)) fields.push("trade");

  /**
   * Website is validated separately because "present but unusable" is a real
   * outcome here — normalizeWebsite returns null both for "not given" and for
   * "given and malformed", and those must not look the same to the sender.
   */
  const websiteGiven = input.website.trim() !== "";
  const website = normalizeWebsite(input.website);
  if (websiteGiven && website === null) fields.push("website");

  if (fields.length > 0) return { ok: false, fields };

  return {
    ok: true,
    values: {
      business_name: businessName,
      email,
      license_number: orNull(input.licenseNumber, LIMITS.licenseNumber),
      trade: trade === "" ? null : trade,
      county: orNull(input.county, LIMITS.county),
      contact_name: orNull(input.contactName, LIMITS.contactName),
      phone: orNull(input.phone, LIMITS.phone),
      website,
      notes: orNull(input.notes, LIMITS.notes),
    },
  };
}

/**
 * Error copy, keyed by the code the action echoes back through `?e=`.
 *
 * Same mechanism as the claim page: a Server Action that redirects cannot return
 * a value, so field errors travel in the URL. Codes are matched against this
 * map before rendering, so a crafted `?e=` cannot inject text onto the page.
 */
export const REQUEST_ERROR_TEXT: Record<string, string> = {
  business_name: "Enter the business name as it should appear in the registry.",
  email: "Enter a valid email address — this is where we'll reply.",
  trade: "Choose a trade from the list.",
  website: "That website address doesn't look right. Try it without the https://",
  spam: "That submission looked automated. Please try again.",
  rate: "We've already received a few requests from your connection today. Email support@floridacontractorregistry.com and we'll pick it up from there.",
  failed: "Something went wrong on our side. Please try again in a moment.",
};
