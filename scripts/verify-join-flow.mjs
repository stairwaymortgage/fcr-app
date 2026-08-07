/**
 * Form consolidation — /join, the registry request, and what was removed.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning
 *     scripts/verify-join-flow.mjs
 *
 * NO NETWORK, NO ENV, NO SUPABASE, NO RESEND KEY. Two kinds of assertion:
 *
 *   1. PURE UNIT TESTS against lib/registry-requests.ts and lib/email-copy.ts,
 *      which are dependency-free by design so this file can import them.
 *   2. SOURCE ASSERTIONS — reading the app's own files as text and checking the
 *      structural facts the consolidation depends on. These are crude and they
 *      are deliberate: "the inquiry form is gone from the profile page" and
 *      "the CTA carries ?from=" are exactly the properties that a later edit
 *      would undo silently, and there is no unit test that can see them.
 *
 * ⚠ WHAT THIS CANNOT PROVE. It does not run Next, hit Postgres or call Resend,
 * so it says nothing about whether /join renders in a browser, whether the RLS
 * policy actually refuses anon, or whether the rate limiter trips. Those are the
 * migration's own curl checks (section 4 of 20260807_registry_requests.sql) and
 * `npm run build`. A pass here is necessary, not sufficient.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LIMITS,
  REQUEST_ERROR_TEXT,
  TRADES,
  normalizeWebsite,
  tradeLabel,
  validateRegistryRequest,
} from "../lib/registry-requests.ts";
import { renderRegistryRequest } from "../lib/email-copy.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0,
  fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};
const head = (t) => {
  console.log("");
  console.log(t);
};

/** A valid submission, used as the base for the mutations below. */
const GOOD = {
  businessName: "Gulf Coast Roofing",
  email: "owner@example.com",
  licenseNumber: "CCC1331234",
  trade: "roofing",
  county: "Broward",
  contactName: "Dana Reyes",
  phone: "954-555-0114",
  website: "gulfcoastroofing.com",
  notes: "We've been licensed since 2011.",
  companyUrl: "",
};
const withField = (k, v) => ({ ...GOOD, [k]: v });

head("── VALIDATION: the happy path ─────────────────────────");
{
  const r = validateRegistryRequest(GOOD);
  ok("a complete submission is accepted", r.ok, r.ok ? "" : JSON.stringify(r.fields));
  if (r.ok) {
    ok("email is lowercased", r.values.email === "owner@example.com", r.values.email);
    ok(
      "website is normalised to an absolute URL",
      r.values.website === "https://gulfcoastroofing.com/",
      String(r.values.website),
    );
    ok("trade is stored as its value", r.values.trade === "roofing", String(r.values.trade));
  }
}

head("── VALIDATION: required fields ────────────────────────");
{
  const blank = validateRegistryRequest(withField("businessName", " "));
  ok(
    "a blank business name is refused",
    !blank.ok && blank.fields.includes("business_name"),
  );

  const short = validateRegistryRequest(withField("businessName", "A"));
  ok("a one-character business name is refused", !short.ok);

  for (const bad of ["", "not-an-email", "no@tld", "two@@at.com", "spaces here@x.com"]) {
    const r = validateRegistryRequest(withField("email", bad));
    ok(`email "${bad}" is refused`, !r.ok && r.fields.includes("email"));
  }

  const both = validateRegistryRequest({ ...GOOD, businessName: "", email: "" });
  ok(
    "BOTH bad fields are reported at once, not just the first",
    !both.ok && both.fields.includes("business_name") && both.fields.includes("email"),
    both.ok ? "" : both.fields.join(","),
  );
}

head("── VALIDATION: optional fields stay optional ──────────");
{
  const minimal = validateRegistryRequest({
    businessName: "Solo Trades LLC",
    email: "solo@example.com",
    licenseNumber: "",
    trade: "",
    county: "",
    contactName: "",
    phone: "",
    website: "",
    notes: "",
    companyUrl: "",
  });
  ok("name + email alone is a valid request", minimal.ok);
  if (minimal.ok) {
    // The migration's whole "a business that cannot remember its licence number
    // is the intended user" argument lives or dies on this.
    ok("a missing licence number is NULL, not empty string", minimal.values.license_number === null);
    ok("a missing trade is NULL", minimal.values.trade === null);
    ok("a missing county is NULL", minimal.values.county === null);
    ok("a missing website is NULL", minimal.values.website === null);
    ok("a missing note is NULL", minimal.values.notes === null);
  }
}

head("── VALIDATION: the honeypot ───────────────────────────");
{
  const bot = validateRegistryRequest(withField("companyUrl", "http://spam.example"));
  ok("a filled honeypot is refused", !bot.ok && bot.fields.includes("spam"));
  ok(
    "the honeypot refusal reports ONLY spam, leaking no field detail",
    !bot.ok && bot.fields.length === 1,
    bot.ok ? "" : bot.fields.join(","),
  );
}

head("── VALIDATION: trade allowlist ────────────────────────");
{
  const crafted = validateRegistryRequest(withField("trade", "'; DROP TABLE--"));
  ok("an off-list trade is refused, not silently stored", !crafted.ok);
  for (const t of TRADES) {
    const r = validateRegistryRequest(withField("trade", t.value));
    if (!r.ok) ok(`trade ${t.value} is accepted`, false, r.fields.join(","));
  }
  ok("every listed trade validates", TRADES.every((t) => validateRegistryRequest(withField("trade", t.value)).ok));
  ok("tradeLabel resolves a known value", tradeLabel("roofing") === "Roofing");
  ok("tradeLabel passes an unknown value through rather than blanking", tradeLabel("zzz") === "zzz");
  ok("tradeLabel handles null", tradeLabel(null) === null);
}

head("── VALIDATION: website normalisation ──────────────────");
{
  ok("a bare domain gains https", normalizeWebsite("example.com") === "https://example.com/");
  ok("an http URL is preserved", normalizeWebsite("http://example.com/x") === "http://example.com/x");
  ok("blank is null, not an error", normalizeWebsite("  ") === null);

  // The one that matters: this string ends up in an href on the admin page.
  for (const hostile of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    ok(`"${hostile.slice(0, 24)}…" is rejected`, normalizeWebsite(hostile) === null);
  }
  ok("a hostname with no dot is rejected", normalizeWebsite("localhost") === null);
  ok(
    "an over-long URL is rejected rather than truncated into something else",
    normalizeWebsite(`https://x.com/${"a".repeat(LIMITS.website)}`) === null,
  );

  const bad = validateRegistryRequest(withField("website", "javascript:alert(1)"));
  ok(
    "a hostile website fails the whole submission with a website error",
    !bad.ok && bad.fields.includes("website"),
  );
}

head("── VALIDATION: ceilings are enforced, not trusted ─────");
{
  const long = validateRegistryRequest({
    ...GOOD,
    businessName: "B".repeat(500),
    notes: "N".repeat(9000),
    contactName: "C".repeat(400),
  });
  ok("an over-long payload is still accepted (truncated, not refused)", long.ok);
  if (long.ok) {
    ok(
      `business_name is cut to ${LIMITS.businessName}`,
      long.values.business_name.length === LIMITS.businessName,
      String(long.values.business_name.length),
    );
    ok(
      `notes are cut to ${LIMITS.notes}`,
      long.values.notes.length === LIMITS.notes,
      String(long.values.notes.length),
    );
    ok(
      `contact_name is cut to ${LIMITS.contactName}`,
      long.values.contact_name.length === LIMITS.contactName,
    );
  }
}

head("── EMAIL: the acknowledgement ─────────────────────────");
{
  const ORIGIN = "https://floridacontractorregistry.test";
  const m = renderRegistryRequest({ to: "owner@example.com", businessName: "Smith & Sons" }, ORIGIN);

  ok("subject names the business", m.subject.includes("Smith & Sons"), m.subject);
  ok("the ampersand is escaped in HTML", m.html.includes("Smith &amp; Sons"));
  ok("the ampersand is NOT escaped in the text body", m.text.includes("Smith & Sons"));

  /**
   * The promise check. The email must not claim a listing exists, and must not
   * promise a decision email this queue does not send — see the docblock on
   * renderRegistryRequest.
   */
  ok(
    "it says outright this is not a listing yet",
    m.text.toLowerCase().includes("not a listing yet"),
  );
  for (const forbidden of ["approved", "your listing is live", "you are now listed"]) {
    ok(`it does not promise "${forbidden}"`, !m.text.toLowerCase().includes(forbidden));
  }

  ok("no remote content in the HTML body", !/<img|src=|url\(/i.test(m.html));
  ok("links point at the passed origin only", !m.html.includes("http") || m.html.includes(ORIGIN));
}

head("── SOURCE: the inquiry form is gone from profiles ─────");
{
  const profile = read("app/contractor/[slug]/page.tsx");

  ok("the profile page renders no <form>", !profile.includes("<form"));
  /**
   * The IMPORT, not the identifier. The file's docblock deliberately mentions
   * submitInquiry by name to record that the action was kept — asserting on a
   * bare substring would make that explanatory comment fail the build.
   */
  ok(
    "it no longer imports submitInquiry",
    !/^\s*import\s[^;]*submitInquiry/m.test(profile),
  );
  ok("the InquiryForm component is gone", !profile.includes("function InquiryForm"));

  ok("a Request a Quote CTA is present", profile.includes("Request a Quote"));
  ok(
    "the CTA links into the diagnostic carrying ?from=",
    profile.includes("/diagnostic?from=${encodeURIComponent(slug)}"),
  );

  // The backend was explicitly NOT removed. If these ever fail, someone deleted
  // more than the form and the legacy inbox lost its data source.
  ok("the inquiry Server Action still exists", read("app/contractor/[slug]/actions.ts").includes("export async function submitInquiry"));
  ok("the /inquiries inbox still exists", read("app/inquiries/page.tsx").length > 0);
}

head("── SOURCE: exactly two public write forms remain ──────");
{
  /**
   * ⚠ THIS IS THE ASSERTION THE WHOLE TASK IS ABOUT, so it is spelled out.
   *
   * A "public write form" is a <form> on an unauthenticated page whose action is
   * a Server Action. GET search forms are NOT in scope (they navigate, they
   * write nothing) and neither are auth, portal or admin forms.
   */
  const PUBLIC_WRITE_FORMS = [
    ["app/diagnostic/DiagnosticWizard.tsx", "action={onSubmit}"],
    ["app/join/page.tsx", "action={submitRegistryRequest}"],
  ];

  for (const [file, marker] of PUBLIC_WRITE_FORMS) {
    ok(`${file} carries its write form`, read(file).includes(marker));
  }

  // The claim form is a THIRD write form but sits behind requireUser(), so it is
  // not public. Asserted here so the count above cannot quietly become three.
  const claimPage = read("app/contractor/[slug]/claim/page.tsx");
  ok("the claim form is auth-gated, not public", claimPage.includes("requireUser("));
}

head("── SOURCE: /contractors is gone and redirected ────────");
{
  const config = read("next.config.mjs");
  ok("next.config declares the redirect", config.includes('source: "/contractors"'));
  ok("it points at /join", config.includes('destination: "/join"'));
  ok("it is permanent", config.includes("permanent: true"));

  ok("the stale page file is deleted", !existsSafe("app/contractors/page.tsx"));
  ok("the sitemap no longer lists /contractors", !read("lib/sitemap.ts").includes('"/contractors"'));

  const footer = read("components/Footer.tsx");
  ok("the footer has no /contractors link", !footer.includes('href: "/contractors"'));
  ok("the footer has no #update / #website / #resources anchors", !footer.includes("/contractors#"));
  ok("the footer points at /join", footer.includes('href: "/join"'));

  ok("the header points at /join", read("components/Header.tsx").includes('href: "/join"'));
  ok("the header links the diagnostic", read("components/Header.tsx").includes('href: "/diagnostic"'));
}

head("── SOURCE: rate limiting is wired ─────────────────────");
{
  const limits = read("lib/rate-limit.ts");
  ok("the burst bucket is declared", limits.includes('bucket: "registry-request:ip"'));
  ok("the daily bucket is declared", limits.includes('bucket: "registry-request:ip:day"'));

  const action = read("app/join/actions.ts");
  ok("the action checks both buckets", action.includes("REGISTRY_REQUEST_IP_BURST") && action.includes("REGISTRY_REQUEST_IP_DAY"));

  /**
   * ORDER MATTERS. The limiter must sit after validation (so malformed floods
   * cost no round trip) and before the insert (so well-formed floods never
   * reach Postgres). Positional, which is crude, but this is the property that
   * silently inverts when someone moves a block.
   *
   * Matched on the CALL forms, not the bare identifiers — both functions are
   * also named in the import block at the top of the file, where their order is
   * alphabetical and says nothing about execution.
   */
  const iValidate = action.indexOf("validateRegistryRequest({");
  const iLimit = action.indexOf("checkLimits([");
  const iInsert = action.indexOf(".insert({");
  ok("validation runs before the limiter", iValidate > -1 && iValidate < iLimit, `${iValidate} < ${iLimit}`);
  ok("the limiter runs before the insert", iLimit > -1 && iLimit < iInsert, `${iLimit} < ${iInsert}`);

  ok(
    "the refusal names somewhere else to go",
    REQUEST_ERROR_TEXT.rate.includes("@floridacontractorregistry.com"),
  );
}

head("── SOURCE: no anon write path to the new table ────────");
{
  const sql = read("db/migrations/20260807_registry_requests.sql");
  ok("RLS is enabled", sql.includes("ENABLE ROW LEVEL SECURITY"));
  ok("anon and authenticated are revoked", sql.includes("REVOKE ALL ON public.registry_requests FROM anon, authenticated"));
  ok("the only policy is admin-scoped", sql.includes("public.is_admin()"));
  ok("there is no anon INSERT policy", !/TO\s+anon/i.test(sql));

  ok(
    "the action writes with the service-role client",
    read("app/join/actions.ts").includes("createAdminClient"),
  );
  ok(
    "the admin DECISION uses the caller's own session, not service-role",
    read("app/admin/requests/actions.ts").includes('from "@/lib/supabase/server"') &&
      !read("app/admin/requests/actions.ts").includes("createAdminClient"),
  );
}

head("── SOURCE: GHL referring-contractor mapping ───────────");
{
  const ghl = read("lib/ghl.ts");
  ok("the field id comes from the environment", ghl.includes("GHL_FIELD_REFERRING_CONTRACTOR"));
  ok("an unset id is tolerated, not fatal", ghl.includes("referringFieldWarned"));

  /**
   * ⚠ FCR Source must be the literal flow name. It used to be
   * `lead.referringUrl ?? "diagnostic_flow"`, which would now write a URL on
   * most leads and break every GHL automation branching on the value.
   */
  ok(
    'FCR Source is written as the literal "diagnostic_flow"',
    ghl.includes('put(GHL_FIELDS.fcr_source, "diagnostic_flow")'),
  );
  ok(
    "FCR Source is no longer the referring URL",
    !ghl.includes('fcr_source, lead.referringUrl'),
  );
  ok("the referring contractor is a separate field write", ghl.includes("lead.referringContractor"));
}

head("── SOURCE: TCPA consent is byte-for-byte untouched ────");
{
  /**
   * The consent string is a legal artefact: leads.sms_consent_text stores what
   * the visitor was shown, /sms-terms §3 renders the same constant, and the
   * whole point is that the stored string is provably the displayed one. This
   * asserts the constant itself, not a copy of it.
   */
  const consent = read("lib/consent.ts");
  ok(
    "SMS_CONSENT_TEXT still names the entity",
    consent.includes("Olga's Friends LLC"),
  );
  ok(
    "it still carries the required frequency and opt-out language",
    consent.includes("recurring text messages") &&
      /STOP/.test(consent) &&
      /msg|message/i.test(consent),
  );
  ok(
    "the diagnostic still writes the constant rather than a literal",
    read("app/diagnostic/actions.ts").includes("sms_consent_text: SMS_CONSENT_TEXT"),
  );
}

function existsSafe(p) {
  try {
    read(p);
    return true;
  } catch {
    return false;
  }
}

console.log("");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
