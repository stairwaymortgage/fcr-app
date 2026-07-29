/**
 * Reads back what is actually in the contractors table and prints the
 * dry-run verification columns. Read-only. Never prints credential values.
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

const { count } = await db
  .from("contractors")
  .select("*", { count: "exact", head: true });
console.log(`contractors table: ${count} rows total\n`);

// county_name comes from the reference table, joined here rather than stored.
const { data: counties } = await db
  .from("reference_counties")
  .select("county_code,county_name");
const countyName = Object.fromEntries(
  counties.map((c) => [c.county_code, c.county_name]),
);

const { data, error } = await db
  .from("contractors")
  .select(
    "license_number,license_number_raw,qualifying_agent_name,business_name,city,county_code," +
      "original_license_date,expiration_date,license_status,license_status_secondary,is_business",
  )
  .order("license_number", { ascending: true, nullsFirst: false });

if (error) {
  console.error(error.message);
  process.exit(1);
}

const HEAD = [
  "license_number", "raw", "name", "city", "cty", "county_name",
  "original", "expiration", "primary", "secondary", "biz",
];

const rows = data.map((r) => [
  r.license_number ?? "(null)",
  r.license_number_raw ?? "(null)",
  (r.qualifying_agent_name ?? "").slice(0, 26),
  r.city ?? "(null)",
  r.county_code ?? "(null)",
  r.county_code ? (countyName[r.county_code] ?? "?? UNMAPPED") : "(null)",
  r.original_license_date ?? "(null)",
  r.expiration_date ?? "(null)",
  r.license_status ?? "(null)",
  r.license_status_secondary ?? "(null)",
  String(r.is_business),
]);

const w = HEAD.map((h, i) =>
  Math.max(h.length, ...rows.map((r) => String(r[i]).length)),
);
console.log(HEAD.map((h, i) => h.padEnd(w[i])).join("  "));
console.log(w.map((n) => "-".repeat(n)).join("  "));
for (const r of rows) {
  const line = r.map((v, i) => String(v).padEnd(w[i])).join("  ");
  console.log(line + (r[0] === "CGC1520921" ? "   <- ACECA" : ""));
}

const aceca = data.find((r) => r.license_number === "CGC1520921");
console.log(`\nAceca business_name from DB: ${JSON.stringify(aceca?.business_name)}`);
