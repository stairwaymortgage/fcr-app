/**
 * Post-import verification. Read-only. Never prints credential values.
 *
 * NOTE ON COLUMN NAMES: the requested query used `name`; the schema column is
 * `qualifying_agent_name` (there is no `name` column). Both it and
 * `business_name` are checked below.
 *
 * NOTE ON THE DUPLICATE-KEY CHECK: PostgREST cannot express
 * GROUP BY ... HAVING count(*) > 1, so keys are paged out and counted here.
 * dbpr_sync_key is also the PRIMARY KEY, so duplicates are structurally
 * impossible — this measures it rather than assuming it.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const countOf = async (build) => {
  const q = build(db.from("contractors").select("*", { count: "exact", head: true }));
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count;
};

console.log("=== QUERY 1 — counts ===");
const total = await countOf((q) => q);
const nullLicense = await countOf((q) => q.is("license_number", null));
const nullAgentName = await countOf((q) => q.is("qualifying_agent_name", null));
const nullBusinessAndAgent = await countOf((q) =>
  q.is("business_name", null).is("qualifying_agent_name", null),
);
const hasCounty = await countOf((q) => q.not("county_code", "is", null));
const nullCity = await countOf((q) => q.is("city", null));
const nullStatus = await countOf((q) => q.is("license_status", null));

console.log(`  total_rows                        ${total.toLocaleString("en-US")}`);
console.log(`  null_license_number               ${nullLicense.toLocaleString("en-US")}`);
console.log(`  null_qualifying_agent_name        ${nullAgentName.toLocaleString("en-US")}`);
console.log(`  null_business_AND_agent_name      ${nullBusinessAndAgent.toLocaleString("en-US")}`);
console.log(`  has_county_code                   ${hasCounty.toLocaleString("en-US")}`);
console.log(`  null_city                         ${nullCity.toLocaleString("en-US")}`);
console.log(`  null_license_status               ${nullStatus.toLocaleString("en-US")}`);

console.log("\n=== QUERY 2 — Aceca, full row ===");
const { data: aceca, error: aErr } = await db
  .from("contractors")
  .select("*")
  .eq("license_number", "CGC1520921");
if (aErr) throw new Error(aErr.message);
console.log(`  rows returned: ${aceca.length}`);
for (const [k, v] of Object.entries(aceca[0] ?? {})) {
  console.log(`    ${k.padEnd(26)} ${JSON.stringify(v)}`);
}

console.log("\n=== QUERY 3 — duplicate dbpr_sync_key ===");
const seen = new Set();
const dups = [];
let from = 0;
const PAGE = 1000;
for (;;) {
  const { data, error } = await db
    .from("contractors")
    .select("dbpr_sync_key")
    .order("dbpr_sync_key", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data.length) break;
  for (const r of data) {
    if (seen.has(r.dbpr_sync_key)) dups.push(r.dbpr_sync_key);
    seen.add(r.dbpr_sync_key);
  }
  from += data.length;
  if (data.length < PAGE) break;
}
console.log(`  keys scanned      ${from.toLocaleString("en-US")}`);
console.log(`  distinct keys     ${seen.size.toLocaleString("en-US")}`);
console.log(`  duplicate keys    ${dups.length}`);
if (dups.length) console.log(`    ${dups.slice(0, 5).join("\n    ")}`);
