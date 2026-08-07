/**
 * Test-row isolation — no suite may touch a row it did not create.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning
 *     scripts/verify-test-row-isolation.mjs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REGRESSION GUARD FOR A LIVE-DATA INCIDENT.
 *
 * On 2026-08-07, GROSSI (CGC1531481) — a real Florida contractor — was found on
 * the public site with claim_tier = 'claimed' and no owner. A verify suite had
 * borrowed its row, approved a fabricated claim against it, and restored it
 * incompletely. See the header of scripts/verify-admin-claims.mjs.
 *
 * Two rules came out of that, and this file enforces both:
 *
 *   1. A mutating suite CREATES its rows (TEST_ROW_PREFIX) and DELETES them. It
 *      never selects a live row to write to.
 *   2. The public read paths exclude those rows anyway, because rule 1 is
 *      enforced by a `finally` block and a `finally` does not survive a kill.
 *
 * Rule 1 is checked by scanning the suites' source for the borrow pattern.
 * Crude, and it is the only thing that can see "this SELECT feeds an UPDATE".
 * Rule 2 is checked live, against the real searchContractors().
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { parseQuery, searchContractors } from "../lib/search.ts";
import { TEST_ROW_LIKE, TEST_ROW_PREFIX } from "../lib/test-rows.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};
const head = (t) => { console.log(""); console.log(t); };

const read = (p) => readFileSync(p, "utf8");

head("── RULE 1: NO SUITE BORROWS A LIVE CONTRACTOR ─────────");
{
  /**
   * The borrow pattern: a ROW-RETURNING select from contractors filtered on
   * claimed_by_user_id being null — i.e. "find me a real unclaimed profile I can
   * experiment on".
   *
   * TWO KINDS OF FALSE POSITIVE HAD TO BE RULED OUT, and both bit on the first
   * run of this check:
   *
   *   · COMMENTS. verify-admin-claims.mjs quotes the old borrowing line verbatim
   *     in its header to record what went wrong. A scanner that reads its own
   *     documentation as code punishes writing the documentation.
   *   · COUNT-ONLY READS. verify-claim-approval.mjs asserts the whole-table
   *     invariant "no ownerless profile claims a tier" with head:true. That
   *     returns no rows and cannot feed a mutation — it is in fact the check
   *     that CAUGHT this incident, so failing it would be perverse.
   *
   * So: strip comments first, then flag only selects that return rows.
   */
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const files = readdirSync("scripts")
    .filter((f) => f.startsWith("verify-") && f.endsWith(".mjs"))
    .sort();

  let borrowers = [];
  for (const f of files) {
    const src = stripComments(read(`scripts/${f}`));
    for (const m of src.matchAll(/from\(\s*["']contractors["']\s*\)/g)) {
      const window = src.slice(m.index, m.index + 400);
      const filtersOnUnclaimed = /\.is\(\s*["']claimed_by_user_id["']\s*,\s*null\s*\)/.test(window);
      const countOnly = /head:\s*true/.test(window);
      if (filtersOnUnclaimed && !countOnly) {
        borrowers.push(f);
        break;
      }
    }
  }

  ok(
    "no verify suite selects a live unclaimed contractor to mutate",
    borrowers.length === 0,
    borrowers.length ? borrowers.join(", ") : `scanned ${files.length} suites`,
  );
}

head("── RULE 1b: MUTATING SUITES USE THE PREFIX ────────────");
{
  const MUTATORS = [
    "verify-admin-claims.mjs",
    "verify-claim-approval.mjs",
    "verify-claim-flow.mjs",
    "verify-id-photo-purge.mjs",
    "verify-profile-lockdown.mjs",
    "verify-release-profile.mjs",
    "verify-contractor-logo.mjs",
    "verify-inquiries-lockdown.mjs",
    "verify-import-phases.mjs",
  ];
  for (const f of MUTATORS) {
    const src = read(`scripts/${f}`);
    ok(`${f} imports the shared prefix`, src.includes("TEST_ROW_PREFIX"));
  }
}

head("── RULE 2: THE READ PATHS EXCLUDE THEM ────────────────");
{
  const search = read("lib/search.ts");
  const browse = read("lib/browse.ts");
  const sitemap = read("lib/sitemap.ts");

  ok("search excludes test rows", search.includes("excludeTestRows"));
  ok("browse excludes test rows", browse.includes("excludeTestRows"));
  ok("sitemap excludes test rows", sitemap.includes("excludeTestRows"));
  /**
   * The sitemap's count and chunk queries must carry the SAME predicate. If one
   * excludes a row the other includes, the index advertises a chunk count the
   * chunks cannot fill and the last file drops URLs.
   */
  ok(
    "the sitemap chunk query carries it too, not just the count",
    sitemap.includes("TEST_ROW_LIKE"),
  );
}

head("── RULE 2 LIVE: A SYNTHETIC ROW IS UNFINDABLE ─────────");
const probeKey = `${TEST_ROW_PREFIX}ISOLATION_${randomUUID().slice(0, 8)}`;
const probeName = `ZZ Isolation Probe ${randomUUID().slice(0, 6)}`;
try {
  const { error } = await admin.from("contractors").insert({
    dbpr_sync_key: probeKey,
    license_number: "ZZTESTLICPROBE",
    license_type: "Certified General Contractor",
    qualifying_agent_name: "Isolation Probe Agent",
    business_name: probeName,
    license_status: "Current,Active",
    city: "Davie",
    claim_tier: "unclaimed",
    // A slug is set DELIBERATELY. Without one the row could never appear in the
    // sitemap anyway, and the test would prove nothing about the filter.
    slug: `zz-isolation-probe-${randomUUID().slice(0, 8)}`,
  });
  if (error) throw new Error(`probe insert: ${error.message}`);

  // It really is in the table — otherwise every assertion below is vacuous.
  const { count: rawCount } = await admin.from("contractors")
    .select("dbpr_sync_key", { count: "exact", head: true })
    .eq("dbpr_sync_key", probeKey);
  ok("the probe row exists in the table", rawCount === 1, `${rawCount} row(s)`);

  // THE REAL FUNCTION, not a re-implementation of its filter.
  const found = await searchContractors(admin, parseQuery(probeName));
  ok("searchContractors does not return it", found.rows.length === 0 && found.total === 0,
     `${found.total} result(s)`);
  ok("and the search did not merely fail", found.failed === false);

  // A control: the same query with the filter lifted DOES find it. Without this
  // the assertion above passes just as happily if search is broken entirely.
  const { count: unfiltered } = await admin.from("contractors")
    .select("dbpr_sync_key", { count: "exact", head: true })
    .ilike("business_name", `%${probeName}%`);
  ok("control: an unfiltered query DOES find it", unfiltered === 1, `${unfiltered} row(s)`);

  // The sitemap predicate.
  const { count: inSitemap } = await admin.from("contractors")
    .select("dbpr_sync_key", { count: "exact", head: true })
    .not("slug", "is", null)
    .not("dbpr_sync_key", "like", TEST_ROW_LIKE)
    .eq("dbpr_sync_key", probeKey);
  ok("the sitemap predicate excludes it", inSitemap === 0, `${inSitemap} row(s)`);
} finally {
  await admin.from("contractors").delete().eq("dbpr_sync_key", probeKey);
}

head("── HOUSEKEEPING: NO LEAKED ROWS LEFT BEHIND ───────────");
{
  const { data, count } = await admin.from("contractors")
    .select("dbpr_sync_key", { count: "exact" })
    .like("dbpr_sync_key", TEST_ROW_LIKE)
    .limit(20);

  /**
   * REPORTS **AND** SWEEPS, and it needs to do both.
   *
   * Reporting alone lets leaked rows pile up run after run. Sweeping alone hides
   * the fact that a suite is dying before its cleanup — which is exactly the
   * failure the read-path filters contain rather than fix. So: fail loudly on
   * what was found, then delete it, so the next run's verdict is about the next
   * run rather than about history.
   *
   * ⚠ THIS IS NOT HYPOTHETICAL AND THE FIRST LEAK WAS THIS SCRIPT'S OWN. Piping
   * a run into `head` closes the pipe, node takes SIGPIPE, and the probe's
   * `finally` never executes — the precise scenario lib/test-rows.ts describes.
   * If this ever reports rows, something killed a suite mid-run; the rows were
   * invisible to the public the whole time, which is the point.
   */
  const leaked = (data ?? []).map((r) => r.dbpr_sync_key);
  if (leaked.length > 0) {
    for (const key of leaked) {
      await admin.from("contractors").delete().eq("dbpr_sync_key", key);
    }
  }

  ok(
    "no synthetic contractor rows were left in the table",
    (count ?? 0) === 0,
    (count ?? 0) === 0 ? "clean" : `${count} leaked and now swept: ${leaked.join(", ")}`,
  );
}

console.log("");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
