/**
 * Connectivity + schema probe. Reads only; writes nothing.
 * Never prints credential values.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing env vars");
  process.exit(1);
}
console.log(`connecting to ${url.replace(/https:\/\/([^.]+)\./, "https://<ref>.")}`);

const db = createClient(url, key, { auth: { persistSession: false } });

// 1. Can we reach the contractors table at all?
const { count, error } = await db
  .from("contractors")
  .select("*", { count: "exact", head: true });

if (error) {
  console.log(`\ncontractors: ERROR ${error.code ?? ""} ${error.message}`);
} else {
  console.log(`\ncontractors: reachable, ${count} rows`);
}

// 2. Which of the migration's columns already exist?
for (const col of [
  "dbpr_sync_key",
  "license_number",
  "license_number_raw",
  "license_status",
  "license_status_secondary",
  "city",
  "county_code",
]) {
  const r = await db.from("contractors").select(col).limit(1);
  console.log(`  ${col.padEnd(26)} ${r.error ? "MISSING (" + r.error.message.slice(0, 60) + ")" : "present"}`);
}

// 3. Reference tables
for (const t of ["reference_counties", "reference_license_types", "sync_runs"]) {
  const r = await db.from(t).select("*", { count: "exact", head: true });
  console.log(`  ${t.padEnd(26)} ${r.error ? "MISSING" : r.count + " rows"}`);
}

// 4. Is arbitrary DDL reachable? (only if an exec_sql RPC was created)
const rpc = await db.rpc("exec_sql", { sql: "select 1" });
console.log(`\nexec_sql RPC: ${rpc.error ? "not available — " + rpc.error.message.slice(0, 70) : "available"}`);
