/**
 * Negative-test harness for the rate limiter.
 *
 * Run AFTER applying db/migrations/20260806_rate_limits.sql:
 *   node --no-warnings scripts/verify-rate-limit.mjs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE POINT IS SECTION E, AND EVERYTHING ELSE IS SUPPORTING WORK.
 *
 * A limiter that counts correctly but is publicly callable is worse than no
 * limiter: PostgREST exposes every function in the public schema as an RPC, so
 * an unrevoked check_rate_limit lets anyone burn any bucket they can guess the
 * identifier for — including locking a real visitor out of the inquiry form with
 * a hash of their IP — and lets them ask "is this identifier currently limited",
 * which is the probing oracle the whole design refuses to grant.
 *
 * The migration's own comment says it: a count of 0 in rate_limits proves
 * nothing. The anon-key attempts in section E are the tests that do.
 *
 * SECTION D IS THE OTHER ONE THAT EARNS ITS PLACE. It asserts that a blocked
 * caller's retries do NOT push their own window forward. Get that wrong and a
 * client that keeps hammering is blocked forever rather than for one window,
 * which turns a spam control into a permanent ban applied by accident — and it
 * would never show up in testing, because you have to keep calling past the
 * refusal to see it.
 *
 * Runs against the LIVE project using .env.local, like the other verify
 * scripts. Every bucket it touches is prefixed 'verify:' and removed in the
 * finally block. It does not read or touch application data.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  PASS" : "  ****FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const head = (t) => { console.log(""); console.log(t); };

/** One call, as the application makes it: service role, through the RPC. */
async function check(bucket, identifier, limit, windowSeconds) {
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_identifier: identifier,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) return { error };
  const row = Array.isArray(data) ? data[0] : data;
  return { row };
}

/** Reads the counter row directly, bypassing the function. */
async function readRow(bucket, identifier) {
  const { data } = await admin
    .from("rate_limits")
    .select("bucket, identifier, window_start, hits")
    .eq("bucket", bucket)
    .eq("identifier", identifier)
    .maybeSingle();
  return data;
}

/** Ages a row by hand so window expiry is testable without waiting. */
async function ageRow(bucket, identifier, seconds) {
  const { error } = await admin
    .from("rate_limits")
    .update({ window_start: new Date(Date.now() - seconds * 1000).toISOString() })
    .eq("bucket", bucket)
    .eq("identifier", identifier);
  if (error) throw new Error(`ageRow: ${error.message}`);
}

const BUCKETS = [];
const mkBucket = (tag) => {
  const b = `verify:${tag}:${randomUUID().slice(0, 8)}`;
  BUCKETS.push(b);
  return b;
};

try {
  // ────────────────────────────────────────────────────────
  head("── A. IT COUNTS, AND IT REFUSES AT THE RIGHT PLACE ─────");
  {
    const bucket = mkBucket("count");
    const r1 = await check(bucket, "abc", 3, 600);
    ok("first call in a fresh bucket is allowed",
       !r1.error && r1.row?.allowed === true && r1.row?.hit_count === 1,
       r1.error?.message ?? `allowed=${r1.row?.allowed} hits=${r1.row?.hit_count}`);
    ok("retry_after is the full window on the first call",
       r1.row?.retry_after > 590 && r1.row?.retry_after <= 600,
       `retry_after=${r1.row?.retry_after}`);

    const r2 = await check(bucket, "abc", 3, 600);
    const r3 = await check(bucket, "abc", 3, 600);
    ok("calls 2 and 3 are allowed (limit is 3)",
       r2.row?.allowed === true && r3.row?.allowed === true,
       `${r2.row?.hit_count}, ${r3.row?.hit_count}`);

    const r4 = await check(bucket, "abc", 3, 600);
    ok("the FOURTH call is refused", r4.row?.allowed === false,
       `allowed=${r4.row?.allowed} hits=${r4.row?.hit_count}`);
    ok("the refusal reports a positive retry_after",
       r4.row?.retry_after > 0, `retry_after=${r4.row?.retry_after}`);
  }

  // ────────────────────────────────────────────────────────
  head("── B. IDENTIFIERS AND BUCKETS ARE ISOLATED ─────────────");
  {
    const bucket = mkBucket("isolate");
    await check(bucket, "one", 2, 600);
    await check(bucket, "one", 2, 600);
    const blocked = await check(bucket, "one", 2, 600);
    ok("'one' is now blocked", blocked.row?.allowed === false);

    const other = await check(bucket, "two", 2, 600);
    ok("a DIFFERENT identifier in the same bucket is unaffected",
       other.row?.allowed === true && other.row?.hit_count === 1,
       `hits=${other.row?.hit_count}`);

    const otherBucket = mkBucket("isolate2");
    const cross = await check(otherBucket, "one", 2, 600);
    ok("the SAME identifier in a different bucket is unaffected",
       cross.row?.allowed === true && cross.row?.hit_count === 1,
       `hits=${cross.row?.hit_count}`);
  }

  // ────────────────────────────────────────────────────────
  head("── C. THE WINDOW EXPIRES, AND RESETS TO 1 ──────────────");
  {
    const bucket = mkBucket("expiry");
    for (let i = 0; i < 4; i++) await check(bucket, "abc", 3, 600);
    const before = await readRow(bucket, "abc");
    ok("four calls recorded four hits", before?.hits === 4, `hits=${before?.hits}`);

    await ageRow(bucket, "abc", 660); // 11 minutes, past the 10-minute window
    const after = await check(bucket, "abc", 3, 600);
    ok("a call after the window expires is allowed again",
       after.row?.allowed === true, `allowed=${after.row?.allowed}`);
    ok("…and the counter RESETS to 1, it does not continue at 5",
       after.row?.hit_count === 1, `hits=${after.row?.hit_count}`);
  }

  // ────────────────────────────────────────────────────────
  head("── D. RETRIES DO NOT EXTEND THE BLOCK ──────────────────");
  //
  // The rejected attempt is counted (that is deliberate — it stops a blocked
  // client probing for the exact threshold), but window_start must NOT move
  // while the window is live. If it did, a client that keeps retrying would
  // renew its own block forever and never recover.
  {
    const bucket = mkBucket("nostretch");
    await check(bucket, "abc", 2, 600);
    await check(bucket, "abc", 2, 600);
    const atBlock = await readRow(bucket, "abc");

    for (let i = 0; i < 5; i++) await check(bucket, "abc", 2, 600);
    const afterRetries = await readRow(bucket, "abc");

    ok("rejected attempts ARE counted",
       afterRetries?.hits === 7, `hits=${afterRetries?.hits}`);
    ok("window_start is UNCHANGED by the retries — the block still expires on time",
       afterRetries?.window_start === atBlock?.window_start,
       `${atBlock?.window_start} -> ${afterRetries?.window_start}`);

    // And the block genuinely lifts once that original window passes.
    await ageRow(bucket, "abc", 660);
    const recovered = await check(bucket, "abc", 2, 600);
    ok("a hammering client recovers after ONE window, not never",
       recovered.row?.allowed === true, `allowed=${recovered.row?.allowed}`);
  }

  // ────────────────────────────────────────────────────────
  head("── E. THE PUBLIC CANNOT REACH ANY OF THIS ──────────────");
  //
  // The tests that matter most. Everything above proves the limiter works;
  // these prove it is not itself an abuse endpoint.
  {
    const { data, error } = await anon.rpc("check_rate_limit", {
      p_bucket: "verify:anon-probe",
      p_identifier: "probe",
      p_limit: 1,
      p_window_seconds: 60,
    });
    ok("anon CANNOT call check_rate_limit", !!error,
       error ? `${error.code ?? ""} ${error.message}`.trim() : `ACCEPTED -> ${JSON.stringify(data)}`);
  }
  {
    const { data, error } = await anon.from("rate_limits").select("bucket, identifier, hits");
    // Either an outright error or zero rows is acceptable — RLS with no policies
    // returns an empty set rather than an error for SELECT.
    ok("anon cannot READ the counters (no threshold oracle)",
       !!error || (data ?? []).length === 0,
       error?.message ?? `${(data ?? []).length} rows`);
  }
  {
    const { error } = await anon.from("rate_limits").insert({
      bucket: "verify:anon-insert", identifier: "x", hits: 0,
    });
    ok("anon cannot INSERT a counter row", !!error, error?.message ?? "ACCEPTED");
  }
  {
    const bucket = mkBucket("anon-delete");
    await check(bucket, "victim", 2, 600);
    await anon.from("rate_limits").delete().eq("bucket", bucket);
    const survived = await readRow(bucket, "victim");
    ok("anon cannot DELETE someone else's counter (no limit reset)",
       !!survived, survived ? `hits=${survived.hits}` : "ROW GONE");
  }
  {
    const bucket = mkBucket("anon-update");
    await check(bucket, "victim", 2, 600);
    await anon.from("rate_limits").update({ hits: 9999 }).eq("bucket", bucket);
    const row = await readRow(bucket, "victim");
    ok("anon cannot INFLATE someone else's counter (no lockout attack)",
       row?.hits === 1, `hits=${row?.hits}`);
  }

  // ────────────────────────────────────────────────────────
  head("── F. ARGUMENTS ARE VALIDATED, NOT TRUSTED ─────────────");
  //
  // The function is SECURITY DEFINER. A caller who could pass p_limit =>
  // 2147483647 would have a documented way to switch the limiter off.
  {
    const cases = [
      ["an empty bucket name", ["", "abc", 3, 600]],
      ["an empty identifier", ["verify:bad", "", 3, 600]],
      ["a limit of 0", ["verify:bad", "abc", 0, 600]],
      ["a negative limit", ["verify:bad", "abc", -1, 600]],
      ["an absurd limit (the off switch)", ["verify:bad", "abc", 2147483647, 600]],
      ["a window of 0", ["verify:bad", "abc", 3, 0]],
      ["a window beyond a week", ["verify:bad", "abc", 3, 604801]],
    ];
    for (const [label, args] of cases) {
      const r = await check(...args);
      ok(`refused: ${label}`, !!r.error, r.error?.message ?? `ACCEPTED -> ${JSON.stringify(r.row)}`);
    }
  }

  // ────────────────────────────────────────────────────────
  head("── G. EVERY DECLARED LIMIT IS ACCEPTED BY THE FUNCTION ─");
  //
  // Parses lib/rate-limit.ts and calls the RPC once per declared bucket. This
  // catches the mismatch that would otherwise only appear in production, on the
  // one endpoint nobody exercised: a spec whose window or limit falls outside
  // the ranges section F enforces would throw at runtime and — because the
  // limiter fails open — leave that endpoint silently unlimited.
  {
    const src = readFileSync("lib/rate-limit.ts", "utf8");
    const specs = [...src.matchAll(
      /bucket:\s*"([^"]+)",\s*limit:\s*([\d_]+),\s*windowSeconds:\s*([\d_]+)/g,
    )].map((m) => ({
      bucket: m[1],
      limit: Number(m[2].replace(/_/g, "")),
      window: Number(m[3].replace(/_/g, "")),
    }));

    ok("found the bucket declarations in lib/rate-limit.ts", specs.length > 0,
       `${specs.length} specs`);

    const names = specs.map((s) => s.bucket);
    ok("every bucket name is unique", new Set(names).size === names.length,
       names.length === new Set(names).size ? "" : "DUPLICATE BUCKET NAME");

    for (const s of specs) {
      const probe = `verify:spec:${s.bucket}`;
      BUCKETS.push(probe);
      const r = await check(probe, "probe", s.limit, s.window);
      ok(`accepted: ${s.bucket} (${s.limit} / ${s.window}s)`,
         !r.error && r.row?.allowed === true,
         r.error?.message ?? "");
    }
  }

  // ────────────────────────────────────────────────────────
  head("── H. RETENTION ────────────────────────────────────────");
  //
  // The sweep the daily cron runs. Rows older than 48h go; live ones stay.
  {
    const bucket = mkBucket("retention");
    await check(bucket, "stale", 5, 600);
    await check(bucket, "fresh", 5, 600);
    await ageRow(bucket, "stale", 49 * 3600);

    const { error } = await admin
      .from("rate_limits")
      .delete()
      .lt("window_start", new Date(Date.now() - 48 * 3600 * 1000).toISOString());

    ok("the retention DELETE runs without error", !error, error?.message ?? "");
    ok("a row older than 48h is removed", !(await readRow(bucket, "stale")));
    ok("a live row SURVIVES the purge", !!(await readRow(bucket, "fresh")));
  }

  console.log("");
  console.log("═".repeat(56));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("═".repeat(56));
} finally {
  console.log("");
  console.log("cleanup…");
  for (const bucket of BUCKETS) {
    await admin.from("rate_limits").delete().eq("bucket", bucket);
  }
  // Anything a failed run left behind under the verify: prefix.
  await admin.from("rate_limits").delete().like("bucket", "verify:%");
  console.log(`removed ${BUCKETS.length} test buckets`);
}
process.exit(fail === 0 ? 0 : 1);
