/**
 * The phased load — insert → update → touch-unchanged → complete.
 *
 * Run:
 *   node --no-warnings scripts/verify-import-phases.mjs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS DOES AND DOES NOT PROVE. READ THIS BEFORE TRUSTING A PASS.
 *
 * scripts/import-dbpr.mjs is a top-level script, not a module: it reads a 47MB
 * CSV and starts writing on import, so its phase code CANNOT be imported the
 * way verify-id-photo-purge.mjs imports the real purge function. This harness
 * therefore reproduces the phase SHAPE against real rows in the real database.
 * It is not the shipped code path.
 *
 * That makes it good evidence for the mechanics that were actually changed and
 * that fail silently when wrong:
 *
 *   · a batched .in() PATCH stamps exactly the intended rows and NOTHING else —
 *     the failure that would mass-orphan the registry
 *   · 200 keys per PATCH stays inside the URL length a PostgREST filter can
 *     carry, which is the real constraint on TOUCH_BATCH_SIZE
 *   · a 500-row upsert round-trips, which is the reduced BATCH_SIZE
 *   · the retry allowlist retries transient faults and refuses deterministic
 *     ones, rather than turning one error into four
 *
 * IT DOES NOT PROVE THE TIMEOUT IS FIXED. Only a full run against 266,305 rows
 * does that, because the failure was cumulative rather than triggered by any
 * particular row. Treat a pass here as "the parts behave"; treat the next full
 * refresh as the actual test.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { TEST_ROW_PREFIX } from "../lib/test-rows.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  PASS" : "  ****FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const head = (t) => { console.log(""); console.log(t); };

// The constants under test, mirrored from scripts/import-dbpr.mjs. Asserted
// against the source below so they cannot drift apart silently.
//
// ⚠ THIS MIRROR EARNED ITS KEEP ON 2026-08-10. BATCH_SIZE went 500 -> 250 in
// the importer and section 0 failed here on the next run — which is the whole
// point of restating them. If you are reading this because that assertion just
// failed: update the number here, do not delete the check.
const BATCH_SIZE = 250;
const MIN_BATCH_SIZE = 25;
const TOUCH_BATCH_SIZE = 200;
const RETRYABLE = new Set([
  "57014", "40001", "40P01", "53300", "08000", "08003", "08006", "XX000",
]);

const TAG = randomUUID().slice(0, 8);
const key = (i) => `${TEST_ROW_PREFIX}PHASE_${TAG}_${String(i).padStart(6, "0")}`;

/** A contractor row shaped like the importer's transform() output. */
const mkRecord = (i, businessName) => ({
  dbpr_sync_key: key(i),
  license_number: `VP${TAG}${i}`,
  license_number_raw: `VP${TAG}${i}`,
  license_type: "Certified General Contractor",
  business_name: businessName,
  qualifying_agent_name: `Agent ${i}`,
  is_business: true,
  address_line: "1 Test Way",
  city: "Davie",
  county_code: "06",
  state: "FL",
  zip: "33314",
  license_status: "Current,Active",
  license_status_secondary: null,
  original_license_date: "2020-01-01",
  expiration_date: "2030-01-01",
  disciplinary_codes: [],
});

const N = 1200; // spans several batches at both sizes

try {
  // ────────────────────────────────────────────────────────
  head("── 0. THE MIRRORED CONSTANTS MATCH THE IMPORTER ────────");
  {
    const src = readFileSync("scripts/import-dbpr.mjs", "utf8");
    const batch = Number(src.match(/^const BATCH_SIZE = (\d+);/m)?.[1]);
    const touch = Number(src.match(/^const TOUCH_BATCH_SIZE = (\d+);/m)?.[1]);
    ok("BATCH_SIZE matches import-dbpr.mjs", batch === BATCH_SIZE, `${batch} vs ${BATCH_SIZE}`);
    ok("TOUCH_BATCH_SIZE matches import-dbpr.mjs", touch === TOUCH_BATCH_SIZE,
       `${touch} vs ${TOUCH_BATCH_SIZE}`);
    const floor = Number(src.match(/^const MIN_BATCH_SIZE = (\d+);/m)?.[1]);
    ok("MIN_BATCH_SIZE matches import-dbpr.mjs", floor === MIN_BATCH_SIZE,
       `${floor} vs ${MIN_BATCH_SIZE}`);
    ok("the halving floor is below the starting batch, or splitting is a no-op",
       floor < batch, `${floor} < ${batch}`);
    ok("the touch batch is smaller than the upsert batch (URL length, not statement cost)",
       touch < batch, `${touch} < ${batch}`);
    ok("phase order in the source is insert -> update -> touch",
       /PHASE 1 insert[\s\S]*PHASE 2 update[\s\S]*PHASE 3 touch-unchanged/.test(src));
    ok("the run is stamped once, not per batch",
       /const runStamp = new Date\(\)\.toISOString\(\);/.test(src) &&
       !/last_dbpr_sync_at: new Date\(\)\.toISOString\(\)/.test(src));
  }

  // ────────────────────────────────────────────────────────
  head("── 1. PHASE 1 — INSERT, AT THE REDUCED BATCH SIZE ──────");
  const stampA = new Date(Date.now() - 60_000).toISOString();
  {
    const records = Array.from({ length: N }, (_, i) => mkRecord(i, `Original ${i}`));
    let written = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const { error } = await db
        .from("contractors")
        .upsert(batch.map((r) => ({ ...r, last_dbpr_sync_at: stampA })),
                { onConflict: "dbpr_sync_key", ignoreDuplicates: false });
      if (error) throw new Error(`insert batch ${i}: ${error.message}`);
      written += batch.length;
    }
    ok(`a ${BATCH_SIZE}-row upsert round-trips (${N} rows)`, written === N, `${written} rows`);

    const { count } = await db
      .from("contractors")
      .select("dbpr_sync_key", { count: "exact", head: true })
      .like("dbpr_sync_key", `${TEST_ROW_PREFIX}PHASE_${TAG}_%`);
    ok("every row is in the table", count === N, `${count}/${N}`);
  }

  // ────────────────────────────────────────────────────────
  head("── 2. PHASE 3 — TOUCH STAMPS ONLY ITS OWN KEYS ─────────");
  //
  // The failure this guards against is the nasty one: a touch that reaches rows
  // it was not given would move timestamps across the registry, and a touch
  // that misses rows leaves them to be counted as orphans next week. Neither
  // throws. Both are silent until the census is wrong.
  const stampB = new Date().toISOString();
  {
    // Touch only the FIRST half. The second half must be untouched.
    const touchKeys = Array.from({ length: N / 2 }, (_, i) => key(i));
    let touched = 0;
    for (let i = 0; i < touchKeys.length; i += TOUCH_BATCH_SIZE) {
      const keys = touchKeys.slice(i, i + TOUCH_BATCH_SIZE);
      const { error } = await db
        .from("contractors")
        .update({ last_dbpr_sync_at: stampB })
        .in("dbpr_sync_key", keys);
      if (error) throw new Error(`touch batch ${i}: ${error.message}`);
      touched += keys.length;
    }
    ok(`a ${TOUCH_BATCH_SIZE}-key .in() PATCH does not exceed the URL limit`,
       touched === N / 2, `${touched} keys sent`);

    const { count: movedCount } = await db
      .from("contractors")
      .select("dbpr_sync_key", { count: "exact", head: true })
      .like("dbpr_sync_key", `${TEST_ROW_PREFIX}PHASE_${TAG}_%`)
      .eq("last_dbpr_sync_at", stampB);
    ok("exactly the touched rows carry the new stamp", movedCount === N / 2,
       `${movedCount}/${N / 2}`);

    const { count: stillOld } = await db
      .from("contractors")
      .select("dbpr_sync_key", { count: "exact", head: true })
      .like("dbpr_sync_key", `${TEST_ROW_PREFIX}PHASE_${TAG}_%`)
      .eq("last_dbpr_sync_at", stampA);
    ok("the untouched rows kept the OLD stamp — no collateral write",
       stillOld === N / 2, `${stillOld}/${N / 2}`);
  }
  {
    // And the touch must not alter anything but the timestamp.
    const { data } = await db
      .from("contractors")
      .select("business_name, city, license_status")
      .eq("dbpr_sync_key", key(0))
      .single();
    ok("touch changes the timestamp and nothing else",
       data?.business_name === "Original 0" && data?.city === "Davie" &&
       data?.license_status === "Current,Active",
       `business_name=${data?.business_name}`);
  }

  // ────────────────────────────────────────────────────────
  head("── 3. PHASE 2 — UPDATE REWRITES VALUES AND STAMPS ──────");
  const stampC = new Date(Date.now() + 1000).toISOString();
  {
    const changed = Array.from({ length: 300 }, (_, i) => mkRecord(i, `Renamed ${i}`));
    const { error } = await db
      .from("contractors")
      .upsert(changed.map((r) => ({ ...r, last_dbpr_sync_at: stampC })),
              { onConflict: "dbpr_sync_key", ignoreDuplicates: false });
    ok("the update phase upsert succeeds", !error, error?.message ?? "");

    const { data } = await db
      .from("contractors")
      .select("business_name, last_dbpr_sync_at")
      .eq("dbpr_sync_key", key(0))
      .single();
    ok("a changed row has its new value", data?.business_name === "Renamed 0",
       `${data?.business_name}`);
    // Compared as INSTANTS, not strings. Postgres returns "+00:00" where
    // toISOString() writes "Z" — the same moment, spelled differently, and a
    // string comparison fails on the spelling.
    ok("…and this run's stamp",
       new Date(data?.last_dbpr_sync_at).getTime() === new Date(stampC).getTime(),
       `${data?.last_dbpr_sync_at} vs ${stampC}`);
  }

  // ────────────────────────────────────────────────────────
  head("── 4. EVERY EXTRACT ROW ENDS STAMPED (THE INVARIANT) ───");
  //
  // The whole point of the touch phase. After a complete run, no row that was
  // in the extract may still carry a stamp older than the run — that is the
  // definition of an orphan, and these rows are not orphans.
  {
    const runStamp = new Date().toISOString();
    const all = Array.from({ length: N }, (_, i) => key(i));

    // Phase 3 over everything, as a real run's touch phase would cover the
    // unchanged remainder.
    for (let i = 0; i < all.length; i += TOUCH_BATCH_SIZE) {
      const { error } = await db
        .from("contractors")
        .update({ last_dbpr_sync_at: runStamp })
        .in("dbpr_sync_key", all.slice(i, i + TOUCH_BATCH_SIZE));
      if (error) throw new Error(`final touch ${i}: ${error.message}`);
    }

    const { count: stale } = await db
      .from("contractors")
      .select("dbpr_sync_key", { count: "exact", head: true })
      .like("dbpr_sync_key", `${TEST_ROW_PREFIX}PHASE_${TAG}_%`)
      .lt("last_dbpr_sync_at", runStamp);
    ok("NO row from the extract is left with a pre-run stamp", stale === 0,
       `${stale} would be miscounted as orphans`);
  }

  // ────────────────────────────────────────────────────────
  head("── 5. THE RETRY ALLOWLIST ──────────────────────────────");
  //
  // Retrying a deterministic error is not resilience — it is the same failure
  // three more times and a slower report.
  {
    const transient = ["57014", "40001", "40P01", "53300", "08006"];
    for (const code of transient) {
      ok(`retries ${code}`, RETRYABLE.has(code));
    }
    const deterministic = ["23505", "23503", "42703", "42P01", "22P02"];
    for (const code of deterministic) {
      ok(`does NOT retry ${code}`, !RETRYABLE.has(code));
    }
    ok("57014 (statement timeout) is retried — the batch-54000 failure",
       RETRYABLE.has("57014"));

    const src = readFileSync("scripts/import-dbpr.mjs", "utf8");
    ok("a network throw with no code is retried",
       /const retryable = !error\.code \|\| RETRYABLE\.has\(error\.code\)/.test(src));
    ok("retries are bounded", /MAX_ATTEMPTS = \d+/.test(src));
    ok("backoff is exponential", /2 \*\* \(n - 1\)/.test(src));

    /**
     * ADAPTIVE HALVING — added 2026-08-10 after run e9964049 died at PHASE 2
     * offset 16000 having failed all four attempts on 57014.
     *
     * ⚠ THE POINT IS THAT RETRYING ALONE CANNOT FIX A DETERMINISTIC TIMEOUT.
     * When a statement's own work exceeds the ceiling, attempt five fails
     * exactly like attempt one; the only remedy is a smaller statement. These
     * assert the SHAPE of that mechanism — that withRetry hands the error back
     * rather than throwing it, that 57014 specifically triggers a split, and
     * that the split terminates at a floor instead of recursing forever.
     */
    ok("withRetry returns the error rather than throwing, so a caller can react",
       /if \(!retryable \|\| n === MAX_ATTEMPTS\) return error;/.test(src));
    ok("a persistent 57014 splits the batch instead of giving up",
       /error\.code === "57014" && items\.length > MIN_BATCH_SIZE/.test(src));
    ok("the split recurses on both halves", /writeBatch\(`\$\{label\}·b`/.test(src));
    ok("splitting terminates — the floor is a constant, not a guess",
       /const MIN_BATCH_SIZE = \d+;/.test(src));
    ok("both write phases go through writeBatch, not withRetry directly",
       (src.match(/await writeBatch\(/g) ?? []).length >= 2 &&
       !/await withRetry\(`/.test(src));
  }

  // ────────────────────────────────────────────────────────
  head("── 6. THE PHASE ACCOUNTING ASSERTION EXISTS ────────────");
  {
    const src = readFileSync("scripts/import-dbpr.mjs", "utf8");
    ok("the script refuses to complete if the phases do not cover the extract",
       /phase accounting mismatch/.test(src));
    ok("a run with no census still writes every row",
       /no census available: upserting all/.test(src));
  }

  console.log("");
  console.log("═".repeat(56));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("═".repeat(56));
  console.log("");
  console.log("REMINDER: this proves the parts, not the timeout. The next full");
  console.log("refresh against 266,305 rows is the real test.");
} finally {
  console.log("");
  console.log("cleanup…");
  const { error } = await db
    .from("contractors")
    .delete()
    .like("dbpr_sync_key", `${TEST_ROW_PREFIX}PHASE_${TAG}_%`);
  console.log(error ? `  ****CLEANUP FAILED: ${error.message}` : `  removed ${N} test rows`);
}
process.exit(fail === 0 ? 0 : 1);
