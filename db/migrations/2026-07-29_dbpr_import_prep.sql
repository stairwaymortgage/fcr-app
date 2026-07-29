-- ==========================================================
-- DBPR initial-import preparation
-- 2026-07-29
--
-- Run in the Supabase SQL editor AFTER 01_schema.sql .. 04_seed_reference_data.sql
-- and BEFORE the initial CONSTRUCTIONLICENSE_1 import.
--
-- Every change here comes from auditing the real 266,312-row extract against
-- the schema. Nothing is speculative; row counts are from that audit.
-- ==========================================================


-- ----------------------------------------------------------
-- 1. city — allow NULL
--
-- 2,673 rows in the extract have no city (2,644 of those have no state
-- either; they are address-less licence records).
--
-- A sentinel such as 'UNKNOWN' was rejected: city drives the /city/[slug]
-- indexes and appears on public profiles, so a sentinel would publish a
-- fictional Florida place. An honest NULL is correct on a data-accuracy site.
-- ----------------------------------------------------------
ALTER TABLE contractors ALTER COLUMN city DROP NOT NULL;


-- ----------------------------------------------------------
-- 2. county_code — allow NULL
--
-- 7,274 rows carry no county code, and a further 22,602 carry an
-- OUT-OF-STATE code (701=AL, 710=GA, 733=NC, 744=TX, 99=mixed, ...).
-- Those 22,602 are contractors registered outside Florida; they have no
-- Florida county and must not be given one.
--
-- A sentinel was rejected more firmly here than for city: county_code is a
-- join key into reference_counties, so a fabricated value either breaks the
-- FK or silently buckets ~30,000 contractors into an invented county.
-- ----------------------------------------------------------
ALTER TABLE contractors ALTER COLUMN county_code DROP NOT NULL;


-- ----------------------------------------------------------
-- 3. license_status_secondary — new column
--
-- DBPR publishes TWO orthogonal statuses, not one. Per
-- https://www2.myfloridalicense.com/about-us/understanding-dbpr-codes/ :
--
--   Primary Status    C = Current      P = Probation    S = Suspended
--   Secondary Status  A = Active       I = Inactive
--
-- Collapsing them loses a distinction that matters for a hiring decision:
-- C+A (111,915 rows) is current AND active, while C+I (14,403 rows) is
-- current but INACTIVE — a licensee who cannot presently work. A single
-- column cannot carry both without compound strings the badge would have to
-- parse.
--
-- Distribution in the extract:
--   C + A  111,915      P + A     166      S + A     141
--   C + —  139,493      P + I      65      S + I      41
--   C + I   14,403      S + —      88
-- ----------------------------------------------------------
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS license_status_secondary text;

COMMENT ON COLUMN contractors.license_status IS
  'DBPR Primary Status, decoded: Current | Probation | Suspended. '
  'NOTE: the public extract NEVER contains Delinquent, Null and Void, or '
  'involuntarily-inactive records — DBPR excludes them from the public '
  'export, so those states cannot appear here and must not be filtered for.';

COMMENT ON COLUMN contractors.license_status_secondary IS
  'DBPR Secondary Status, decoded: Active | Inactive | NULL. '
  'NULL is common (139,581 rows) and means DBPR published no secondary '
  'status, not that the licence is inactive.';


-- ----------------------------------------------------------
-- 4. license_number_raw — new column (OPTIONAL, see note)
--
-- The extract carries the licence number twice:
--   field 13 "License Number"   -> 1520921    (bare, zero-padded)
--   field 21 "Alternate Lic#"   -> CGC1520921 (prefixed)
--
-- Despite the official field names, the PREFIXED form is the public
-- identifier: it is what the mockups display, what users search, and what
-- profile URLs use (aceca-construction-cgc1520921-davie). So
-- contractors.license_number takes field 21.
--
-- Field 13 is kept here because it is not reliably derivable from field 21 —
-- the zero-padding differs (CBC + 0015061 -> CBC015061, not CBC0015061), which
-- is why a naive concat mismatches on 45,953 rows.
--
-- Drop this statement if the bare number is not wanted.
-- ----------------------------------------------------------
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS license_number_raw text;

COMMENT ON COLUMN contractors.license_number IS
  'Prefixed DBPR licence number, e.g. CGC1520921 (extract field 21, '
  '"Alternate Lic#"). This is the public identifier used in search and in '
  'profile URLs. NULLABLE: 125,355 of 266,312 extract rows have none.';

COMMENT ON COLUMN contractors.license_number_raw IS
  'Bare DBPR licence number, e.g. 1520921 (extract field 13, "License '
  'Number"). Kept for source fidelity; not derivable from license_number '
  'because zero-padding differs between the two fields.';


-- ----------------------------------------------------------
-- 5. county_code semantics — comment only, no DDL
--
-- The extract's county codes are NOT the codes in reference_counties.
-- DBPR code = reference_counties.county_code + 10, verified against all 67
-- codes present in the extract (11=Alachua .. 77=Washington) and spot-checked
-- against known city/county facts (16 -> Fort Lauderdale/Davie = Broward,
-- 23 -> Miami/Hialeah = Miami-Dade, 60 -> Boca Raton/WPB = Palm Beach).
--
-- The ingest translates dbpr_code - 10 and stores the reference_counties code,
-- so this column stays joinable. Codes outside 11..77 are out-of-state and
-- are stored as NULL.
--
-- Build Brief §09 states "Broward = '06' in DBPR". That is wrong for this
-- extract: no row carries code 06, and Broward's cities carry 16.
-- ----------------------------------------------------------
COMMENT ON COLUMN contractors.county_code IS
  'reference_counties.county_code (01-67), TRANSLATED on ingest from the '
  'DBPR extract code by subtracting 10. NULL for out-of-state registrants '
  '(22,602 rows) and for rows DBPR published with no county (7,274 rows).';
