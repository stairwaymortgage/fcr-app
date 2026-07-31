import "server-only";

import type { Answers } from "@/lib/personas";

/**
 * GoHighLevel push — LeadConnector API v2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO ENTITY NAMES GO TO GHL. The payload carries the persona slug, the seven
 * answers, contact details and consent — and nothing from lib/lead-routing.ts.
 * leads.routed_entities stays in Postgres for the concierge; routing to an
 * entity is a GHL automation keyed on the persona, not data we transmit.
 *
 * `import "server-only"` for the same reason as lead-routing: this file holds
 * the API token path and must never be reachable from a client component.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * VERIFIED AGAINST THE LIVE LOCATION 2026-07-31:
 *   - PIT + `Version: 2021-07-28` on services.leadconnectorhq.com works.
 *     /locations/{id} returns 401 (that scope was not granted) but the
 *     endpoints used here return 200/201.
 *   - contact.sms_consent_text is LARGE_TEXT with no maxLength; a 582-character
 *     consent string round-tripped byte-identical.
 *   - GHL ACCEPTS OUT-OF-RANGE SINGLE_OPTIONS VALUES SILENTLY. Posting
 *     "long_term_owner" to contact.persona — whose options are speed_to_sale,
 *     maximize_value, … — returned HTTP 201 and stored it verbatim. There is no
 *     validation to lean on, which is why this module validates before sending.
 */

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

/** Field ids fetched from the live location on 2026-07-31. */
export const GHL_FIELDS = {
  persona: "9a6Llc5Z8W2u8WLVQz0Q", // contact.persona            SINGLE_OPTIONS
  project_type: "j8lB8DnU9KgGqsLQ521g", // contact.project_type       SINGLE_OPTIONS
  budget: "Njz2DiWcNvC2A13EbiZI", // contact.budget            SINGLE_OPTIONS
  timeline: "JXDKxZMlZFyHIDktMLhD", // contact.timeline          SINGLE_OPTIONS
  financing_needed: "iG7oxSEUDyT1zT9t6NVK", // contact.financing_needed  SINGLE_OPTIONS
  selling_plans: "lC7UjhEwKmImENMzKU0P", // contact.selling_plans     SINGLE_OPTIONS
  insurance: "szSVA7enKMJMiZyOzbYp", // contact.insurance         SINGLE_OPTIONS
  contact_preference: "KFquDRKg3E118jyWNnts", // contact.contact_preference SINGLE_OPTIONS
  sms_consent_text: "30mfXR8PIp8bzb7gqxtK", // contact.sms_consent_text  LARGE_TEXT
  consent_timestamp: "UTVNYL0y69rSrorO7WVq", // contact.consent_timestamp DATE
  fcr_source: "NAF3nVcw9UX7cQh2rdFv", // contact.fcr_source        TEXT
} as const;

export const GHL_PIPELINE = {
  id: "U1PrjN4PmMlhahGWMbpg", // "FCR Leads"
  stages: {
    newLead: "4f5ade7a-4bb6-4787-a726-272e8adb5b65",
    contacted: "5cc6deec-f840-41cf-ada7-5413d288fe8f",
    qualified: "f181fff1-6b95-446e-827d-d578e6d9c627",
    closed: "922c3424-0cab-4b84-88de-37e278fcbc17",
  },
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE DROPDOWN VALUES DO NOT LINE UP, AND FOUR FIELDS HAVE NO SOURCE.
 *
 * The GHL fields were built against a different question set — seller-intent
 * personas and a kitchen/bathroom/addition project type. The diagnostic asks
 * different questions and writes different values. Not one option matches.
 *
 *   GHL contact.persona      speed_to_sale | maximize_value | distress_urgent |
 *                            inherited_property | tired_landlord | relocating |
 *                            downsizing | first_time_seller
 *   diagnostic writes        urgent_owner | quality_seeker | tax_distressed |
 *                            fix_and_flip | new_to_town | long_term_owner |
 *                            senior_equity
 *
 * And contact.budget, contact.timeline, contact.insurance and
 * contact.contact_preference have NO corresponding question at all.
 *
 * TRANSLATING THEM IS A BUSINESS DECISION, NOT A CODE ONE. Whether
 * "long_term_owner" is GHL's "maximize_value" or something else determines
 * which automation fires and therefore which entity gets the lead. Guessing it
 * here would be inventing revenue routing.
 *
 * So the map below is EXPLICIT and currently EMPTY. Unmapped values are
 * OMITTED from the payload and logged — never sent raw. That matters because
 * GHL accepts invalid options silently: sending "long_term_owner" would look
 * like success while every automation filtering on it never matched.
 *
 * Fill this in, or realign the GHL options to the diagnostic's values, and the
 * fields start populating with no other change.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const PERSONA_TO_GHL: Partial<Record<string, string>> = {
  // urgent_owner:    "…",
  // quality_seeker:  "…",
  // tax_distressed:  "…",
  // fix_and_flip:    "…",
  // new_to_town:     "…",
  // long_term_owner: "…",
  // senior_equity:   "…",
};

/** Q1 → contact.project_type. Same situation as the persona map. */
const Q1_TO_PROJECT_TYPE: Partial<Record<string, string>> = {};

/** Q3 → contact.financing_needed. GHL: yes_financing | paying_cash | not_sure_financing */
const Q3_TO_FINANCING: Partial<Record<string, string>> = {};

/** Q4 → contact.selling_plans. GHL: selling_after | staying_put | might_sell */
const Q4_TO_SELLING: Partial<Record<string, string>> = {};

export interface GhlLead {
  name: string;
  email: string;
  /** Already E.164 by the time it reaches here. */
  phone: string;
  zip: string | null;
  personaSlug: string;
  answers: Answers;
  smsConsent: boolean;
  smsConsentText: string | null;
  smsConsentTimestamp: string | null;
  referringUrl: string | null;
}

export interface GhlResult {
  ok: boolean;
  contactId?: string;
  opportunityId?: string;
  error?: string;
  /** Fields skipped because no mapping exists. Surfaced so the gap is visible. */
  unmapped: string[];
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Version: VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** GHL DATE fields want a plain calendar date, not a full timestamp. */
function toDateOnly(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/**
 * Split a single name field into first/last for GHL.
 * A one-word name becomes the first name with no surname, which is better than
 * guessing at a split that isn't there.
 */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/**
 * Push one lead to GoHighLevel: upsert the contact, then open an opportunity.
 *
 * NEVER THROWS. Every failure path returns { ok: false, error }, because the
 * caller has already saved the lead and must not have its own success undone by
 * a delivery problem.
 */
export async function pushLeadToGhl(lead: GhlLead): Promise<GhlResult> {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  const unmapped: string[] = [];

  if (!token || !locationId) {
    return { ok: false, error: "GHL_API_TOKEN or GHL_LOCATION_ID not set", unmapped };
  }

  /**
   * Only fields with a known-good value are included. A missing mapping omits
   * the field and records why — it never sends a raw diagnostic value into a
   * dropdown that would accept it silently and mean nothing.
   */
  const customFields: { id: string; value: string }[] = [];
  const put = (id: string, value: string | null | undefined) => {
    if (value != null && value !== "") customFields.push({ id, value });
  };

  const mapped = (
    label: string,
    table: Partial<Record<string, string>>,
    raw: string | undefined,
  ): string | undefined => {
    if (!raw) return undefined;
    const out = table[raw];
    if (!out) {
      unmapped.push(`${label}=${raw}`);
      return undefined;
    }
    return out;
  };

  put(GHL_FIELDS.persona, mapped("persona", PERSONA_TO_GHL, lead.personaSlug));
  put(GHL_FIELDS.project_type, mapped("project_type", Q1_TO_PROJECT_TYPE, lead.answers[1]));
  put(GHL_FIELDS.financing_needed, mapped("financing_needed", Q3_TO_FINANCING, lead.answers[3]));
  put(GHL_FIELDS.selling_plans, mapped("selling_plans", Q4_TO_SELLING, lead.answers[4]));

  // budget / timeline / insurance / contact_preference have no source question.
  unmapped.push("budget=(no question)", "timeline=(no question)",
                "insurance=(no question)", "contact_preference=(no question)");

  // Free-text fields carry their real values — no dropdown to mismatch.
  put(GHL_FIELDS.fcr_source, lead.referringUrl ?? "diagnostic_flow");
  if (lead.smsConsent) {
    put(GHL_FIELDS.sms_consent_text, lead.smsConsentText);
    put(GHL_FIELDS.consent_timestamp, toDateOnly(lead.smsConsentTimestamp));
  }

  const { firstName, lastName } = splitName(lead.name);

  try {
    /**
     * upsert, not create: a homeowner who runs the diagnostic twice should be
     * one contact with updated answers, not two records the concierge has to
     * reconcile. GHL matches on email/phone within the location.
     */
    const contactRes = await fetch(`${BASE}/contacts/upsert`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        locationId,
        firstName,
        lastName,
        email: lead.email,
        phone: lead.phone,
        postalCode: lead.zip ?? undefined,
        source: "Florida Contractor Registry — diagnostic",
        customFields,
      }),
    });

    if (!contactRes.ok) {
      const body = await contactRes.text();
      return {
        ok: false,
        error: `contact upsert ${contactRes.status}: ${body.slice(0, 300)}`,
        unmapped,
      };
    }

    const contactBody = await contactRes.json();
    const contactId: string | undefined = contactBody?.contact?.id ?? contactBody?.id;
    if (!contactId) {
      return { ok: false, error: "contact upsert returned no id", unmapped };
    }

    const oppRes = await fetch(`${BASE}/opportunities/`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        locationId,
        pipelineId: GHL_PIPELINE.id,
        pipelineStageId: GHL_PIPELINE.stages.newLead,
        contactId,
        name: `${lead.name} — diagnostic`,
        status: "open",
      }),
    });

    if (!oppRes.ok) {
      const body = await oppRes.text();
      // The contact landed; only the opportunity failed. Report the contact id
      // so a retry can attach the opportunity rather than duplicating the
      // contact.
      return {
        ok: false,
        contactId,
        error: `opportunity ${oppRes.status}: ${body.slice(0, 300)}`,
        unmapped,
      };
    }

    const oppBody = await oppRes.json();
    return {
      ok: true,
      contactId,
      opportunityId: oppBody?.opportunity?.id ?? oppBody?.id,
      unmapped,
    };
  } catch (err) {
    return { ok: false, error: `network: ${String(err).slice(0, 300)}`, unmapped };
  }
}
