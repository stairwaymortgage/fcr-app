import "server-only";

import { QUESTIONS, type Answers } from "@/lib/personas";

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
 *   - GHL DISCARDS OUT-OF-RANGE SINGLE_OPTIONS VALUES AND REPORTS SUCCESS.
 *     Re-tested precisely on 2026-08-01: posting fix_and_flip, buying_to_flip,
 *     fast_capital and sell_different to the four dropdowns whose options do
 *     not include them returned HTTP 201, and reading the contact back showed
 *     0 of 4 present — not stored wrong, not stored at all.
 *
 *     THIS IS THE WHOLE PROBLEM, AND NO CHANGE HERE CAN SOLVE IT. A dropdown
 *     stores only what it defines. Sending the value anyway is not a workaround;
 *     it is the thing that was already happening and already failing. The four
 *     fields can be filled only by editing their options in the GHL UI — which
 *     this token cannot do (401 on both POST and PUT to /customFields).
 */

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

/**
 * Field ids fetched from the live location on 2026-07-31.
 *
 * budget, timeline, insurance and contact_preference are deliberately ABSENT.
 * They existed in GHL but no diagnostic question produces them, so they could
 * only ever have been blank. Jim is deleting them from the location; listing
 * them here would just be a promise the wizard cannot keep.
 */
export const GHL_FIELDS = {
  persona: "9a6Llc5Z8W2u8WLVQz0Q", // contact.persona           SINGLE_OPTIONS
  project_type: "j8lB8DnU9KgGqsLQ521g", // contact.project_type      SINGLE_OPTIONS
  financing_needed: "iG7oxSEUDyT1zT9t6NVK", // contact.financing_needed  SINGLE_OPTIONS
  selling_plans: "lC7UjhEwKmImENMzKU0P", // contact.selling_plans     SINGLE_OPTIONS
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
 * DROPDOWN VALUES ARE VALIDATED AGAINST GHL'S LIVE OPTIONS, NOT A HARD-CODED MAP.
 *
 * WHY THIS ISN'T A TRANSLATION TABLE. The original design had a static
 * persona→GHL map. It was the wrong shape for two reasons:
 *
 *   1. It made "which value goes where" a code deploy. Routing lives in GHL
 *      automations by design (Row 126) so it can change in the UI; the value
 *      feeding those automations must be able to change there too.
 *   2. It had to be kept in lockstep with the GHL UI by hand. A map that
 *      disagrees with the location's actual options fails silently — see below.
 *
 * SO THE RULE IS: send the diagnostic's own value if — and only if — the field
 * in GHL actually offers it. Options are read from the location and cached
 * briefly. Realign a dropdown in the GHL UI and leads start populating within
 * the cache TTL, with no deploy.
 *
 * WHY VALIDATE AT ALL — GHL DISCARDS OUT-OF-RANGE OPTIONS AND RETURNS 201.
 * Posting "fix_and_flip" to a field whose options are speed_to_sale,
 * maximize_value, … succeeds, and the value is then absent from the contact.
 * Validating changes nothing about what lands; it changes whether anyone can
 * SEE why nothing landed. An unmatched value is recorded in `unmapped` with the
 * field's type and its real option list, so the gap is loud instead of a blank
 * cell nobody can explain.
 *
 * AS OF 2026-07-31 the four dropdowns still carry a seller-intent taxonomy
 * (persona: speed_to_sale | maximize_value | distress_urgent | …) that shares
 * no value with the diagnostic (urgent_owner | quality_seeker | …), so all four
 * are omitted on every lead. Realigning them in the GHL UI is the fix; the API
 * token has no customFields write scope, so it cannot be done from here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Diagnostic value → GHL field, for the fields whose value is a dropdown. */
const OPTION_FIELDS = [
  { key: "persona", id: GHL_FIELDS.persona },
  { key: "project_type", id: GHL_FIELDS.project_type },
  { key: "financing_needed", id: GHL_FIELDS.financing_needed },
  { key: "selling_plans", id: GHL_FIELDS.selling_plans },
] as const;

/**
 * Cached field definitions, keyed by field id.
 *
 * THE FIELD'S TYPE DECIDES WHETHER ITS VALUE IS CHECKED. A dropdown only
 * accepts values it defines, so those are validated. A text field accepts
 * anything, so its value is sent as-is. Reading the type from GHL rather than
 * assuming it means either choice works in the UI — convert Persona from a
 * dropdown to plain text and delivery keeps working, with no deploy.
 *
 * Short TTL on purpose: this exists to spare one HTTP call per lead, not to be
 * a source of truth. A GHL UI edit must take effect on its own, and 5 minutes
 * is the longest we should make someone wonder whether it worked. Per-process,
 * so serverless instances expire independently — which is fine, because a stale
 * instance omits a field rather than sending a wrong one.
 */
interface GhlFieldDef {
  dataType: string;
  /** Empty for free-text field types. */
  options: Set<string>;
}

/** GHL types whose value must be one of the field's defined options. */
const CONSTRAINED_TYPES = new Set(["SINGLE_OPTIONS", "MULTIPLE_OPTIONS", "RADIO", "CHECKBOX"]);

const OPTIONS_TTL_MS = 5 * 60 * 1000;
let fieldCache: { at: number; byFieldId: Map<string, GhlFieldDef> } | null = null;

async function fetchFieldDefs(
  token: string,
  locationId: string,
): Promise<Map<string, GhlFieldDef> | null> {
  if (fieldCache && Date.now() - fieldCache.at < OPTIONS_TTL_MS) {
    return fieldCache.byFieldId;
  }
  try {
    const res = await fetch(`${BASE}/locations/${locationId}/customFields`, {
      headers: headers(token),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const byFieldId = new Map<string, GhlFieldDef>();
    for (const f of body?.customFields ?? []) {
      // GET returns picklistOptions; the create/update API calls the same thing
      // `options`. Accept either rather than depend on which one this version
      // of the API happens to send.
      const raw: unknown[] = f?.picklistOptions ?? f?.options ?? [];
      const values = raw
        .map((o) =>
          typeof o === "string" ? o : ((o as Record<string, string>)?.value ?? null),
        )
        .filter((v): v is string => typeof v === "string");
      byFieldId.set(f.id, { dataType: String(f?.dataType ?? ""), options: new Set(values) });
    }
    fieldCache = { at: Date.now(), byFieldId };
    return byFieldId;
  } catch {
    // Never fatal. The caller omits these fields and still delivers the lead.
    return null;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAGS ARE THE PRIMARY DELIVERY CHANNEL FOR THE ANSWERS. CUSTOM FIELDS ARE NOT.
 *
 * Custom fields turned out to be the wrong mechanism for this integration, for
 * a reason that is not going to change on its own: the four dropdown fields
 * were built against a different question set, and the API token cannot fix
 * them. Verified 2026-07-31 — every write path is refused:
 *
 *   POST /locations/{id}/customFields   -> 401 not authorized for this scope
 *   PUT  /locations/{id}/customFields/… -> 401 not authorized for this scope
 *
 * So the fields can neither be realigned nor replaced from here. They can only
 * be edited by hand in the GHL UI, and until someone does, four of them reject
 * every value the diagnostic produces.
 *
 * TAGS HAVE NO SCHEMA. They need no field definition, no option list, no
 * matching taxonomy and no scope beyond the contacts.write we already use —
 * confirmed by upserting a contact with tags and reading them back intact. And
 * they are first-class in HighLevel automation: a workflow can trigger on
 * "Contact Tag" and branch on tag conditions, which is exactly the persona
 * routing Row 126 calls for.
 *
 * So all seven answers and the persona ship as tags, always. The custom-field
 * writes stay as well — they cost nothing, they populate the three text fields
 * today, and the four dropdowns will start filling the moment their options are
 * corrected. Nothing is lost by keeping both; the lead stops depending on it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** `fcr-persona-quality_seeker`, `fcr-q1-own_renovating`, … */
function buildTags(personaSlug: string, answers: Answers): string[] {
  const tags = [`fcr-persona-${personaSlug}`];
  for (const q of QUESTIONS) {
    const value = answers[q.id];
    if (value) tags.push(`fcr-q${q.id}-${value}`);
  }
  return tags;
}

/**
 * A readable transcript for whoever opens the contact.
 *
 * The tags carry the machine-readable values for automations; a concierge
 * reading `fcr-q3-preserve_savings` before a call should not have to decode it.
 * Labels come from QUESTIONS, the same definitions the wizard renders, so the
 * note says what the visitor actually saw.
 */
function buildNote(personaSlug: string, answers: Answers): string {
  const lines = [`Florida Contractor Registry — diagnostic`, ``, `Persona: ${personaSlug}`, ``];
  for (const q of QUESTIONS) {
    const value = answers[q.id];
    if (!value) continue;
    const choice = q.choices.find((c) => c.value === value);
    lines.push(`Q${q.id}. ${q.prompt}`);
    lines.push(`    ${choice?.label ?? value}   [${value}]`);
  }
  return lines.join("\n");
}

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

  /**
   * The four dropdown fields. Each carries the diagnostic's own value if GHL
   * offers it as an option, and is omitted-and-recorded otherwise.
   *
   * The reason for the rejection is kept in `unmapped` — "not an option in GHL"
   * versus "GHL unreachable" versus "visitor skipped the question" are three
   * different problems and the log should not make them look like one.
   */
  const values: Record<string, string | undefined> = {
    persona: lead.personaSlug,
    project_type: lead.answers[1],
    financing_needed: lead.answers[3],
    selling_plans: lead.answers[4],
  };

  const defs = await fetchFieldDefs(token, locationId);

  for (const field of OPTION_FIELDS) {
    const value = values[field.key];
    if (!value) continue; // Not answered. Nothing to say about it.
    if (!defs) {
      unmapped.push(`${field.key}=${value} (could not read GHL field definitions)`);
      continue;
    }
    const def = defs.get(field.id);
    if (!def) {
      unmapped.push(`${field.key}=${value} (no such field in GHL — deleted?)`);
      continue;
    }

    // A free-text field accepts anything, so there is nothing to check.
    if (!CONSTRAINED_TYPES.has(def.dataType)) {
      put(field.id, value);
      continue;
    }

    if (!def.options.has(value)) {
      // Array.from, not spread: tsconfig sets no target, so downlevel iteration
      // of a Set is a compile error. Same fix as lib/format-name.ts.
      unmapped.push(
        `${field.key}=${value} (not an option of ${def.dataType}; ` +
          `GHL has ${Array.from(def.options).join("|") || "none"})`,
      );
      continue;
    }
    put(field.id, value);
  }

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
        // The answers, in the one form GHL cannot reject. See buildTags above.
        tags: buildTags(lead.personaSlug, lead.answers),
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

    /**
     * Best-effort transcript. Deliberately not allowed to affect the result:
     * the answers are already delivered as tags by this point, so a failed note
     * is a cosmetic loss, and marking the lead undelivered over it would put a
     * fully-delivered contact into the retry queue.
     */
    try {
      const noteRes = await fetch(`${BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ body: buildNote(lead.personaSlug, lead.answers) }),
      });
      if (!noteRes.ok) {
        console.warn("[ghl] note not created", {
          contactId,
          status: noteRes.status,
          body: (await noteRes.text()).slice(0, 200),
        });
      }
    } catch (err) {
      console.warn("[ghl] note threw", { contactId, error: String(err).slice(0, 200) });
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

      /**
       * A REPEAT VISITOR IS NOT A FAILURE.
       *
       * Run the diagnostic twice and the contact upserts happily, but GHL
       * refuses the second opportunity:
       *
       *   400 {"code":"OPPORTUNITY_NO_DUPLICATE",
       *        "message":"Can not create duplicate opportunity for the contact.",
       *        "meta":{"existingId":"…"}}
       *
       * Caught in testing on 2026-07-31. Treated as failure this would be
       * actively harmful: the contact's answers HAVE been updated, yet the lead
       * would be marked ghl_synced = false and sit in a retry queue that can
       * never drain, because every retry hits the same 400. Worse, the real
       * delivery problems would be buried under it.
       *
       * The existing opportunity id comes back in meta, so we adopt it and
       * report success — which is the truth: this contact is in the pipeline.
       */
      let existingId: string | undefined;
      try {
        existingId = JSON.parse(body)?.meta?.existingId;
      } catch {
        // Non-JSON error body. Falls through to the failure path below.
      }
      if (existingId) {
        return { ok: true, contactId, opportunityId: existingId, unmapped };
      }

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
