-- ==========================================================
-- Reference-table contractor_count repair — RE-RUNNABLE
-- Created 2026-08-05. NOT APPLIED — Jim runs this in the SQL editor.
-- ==========================================================
--
-- Supersedes the draft 20260805_license_type_counts.sql, which covered licence
-- types only. This file covers all three reference tables and is written to be
-- run again after every DBPR refresh, which is the maintenance step
-- 20260730_reference_counts.sql asked for in its closing note and nothing has
-- performed since.
--
-- NO DEPLOY-ORDER CONSTRAINT. Nothing in the application calls anything here.
-- /types reads the column section 2 fills; running this makes that page correct
-- and changes nothing else. Safe to run before or after any deploy.
--
-- VERIFY WITH:  node scripts/verify-counts.mjs --verbose
-- That script measures each table against the same rule this file applies, so
-- "0 mismatched" after running here is a real check rather than a restatement.
--
--
-- ==========================================================
-- ⚠ WHAT IS ACTUALLY BROKEN, MEASURED ON THE LIVE PROJECT 2026-08-05
-- ==========================================================
--
--   reference_license_types   18 of 29 rows wrong. ALL 29 read 0.
--   reference_counties         0 of 67 rows wrong.  Nothing to repair.
--   reference_cities           0 of 710 rows wrong. Nothing to repair.
--
-- THE "42 OF 67 COUNTIES ARE WRONG" FIGURE IS AN ARTEFACT OF THE CHECK, NOT A
-- DEFECT IN THE DATA. It is reproducible and it is the wrong question.
--
-- 20260730_reference_counts.sql defines a county's count as
--
--     count(*) WHERE state = 'FL' AND county_code = <code>
--
-- and the stored values match that definition on all 67 rows, exactly. Drop the
-- state filter and 42 rows disagree — because 27,250 records carry an
-- out-of-state mailing address, and re-counting without the filter asks "how
-- many records carry this county code, wherever they are addressed", which is a
-- different question with a different and correct answer.
--
-- The filter is deliberate and it is the reason reference_cities does not
-- publish a Birmingham page listing 257 Alabama contractors. Removing it to make
-- the numbers "agree" would reintroduce precisely the bug 20260730 fixed.
--
-- So the county and city blocks below are NO-OPS TODAY. They are here anyway,
-- because after a DBPR refresh they will not be: this file is the one place the
-- refresh maintenance lives, and a file that repairs two of three tables invites
-- the third to drift again.
--
--
-- ==========================================================
-- ⚠ THE TAXONOMY PROBLEM SECTION 2 DOES NOT FIX
-- ==========================================================
--
-- reference_license_types and the DBPR extract do not describe the same set of
-- codes. Measured 2026-08-05:
--
--   MATCHING BOTH SIDES (18): CAC CBC CCC CFC CGC CMC CPC CRC CSC CUC CVC
--                             RB RC RF RG RM RP RR
--
--   IN THE EXTRACT, ABSENT FROM THE REFERENCE TABLE (11 codes, 154,051 rows —
--   more than half the registry):
--       QB    125,348     Qualifying Business
--       FRO    18,723     Financially Responsible Officer
--       CRS1    4,970
--       SCC     3,727
--       PCC       372
--       RA        316
--       PVDR      284
--       RX        213
--       RU         62
--       RQ         27
--       RS          9
--
--   IN THE REFERENCE TABLE, ABSENT FROM THE EXTRACT (11): CDC CGL CIC CLC CSM
--       CTC CWC EC ER ES MC
--       — including EC, Certified Electrical Contractor, which the admin
--       contractors mockup lists in its filter dropdown.
--
-- So /types currently advertises eleven licence types that have no contractors
-- at all, and omits the code 47% of the registry belongs to.
--
-- THIS FILE DOES NOT FIX THAT, DELIBERATELY. Adding QB and FRO to a public page
-- headed "License Types" would publish "Qualifying Business" and "Financially
-- Responsible Officer" as though they were trades a homeowner should browse by.
-- They are registration roles. Whether they belong in that index — and under
-- what heading — is a taxonomy decision for Jim, not something a migration
-- should settle by inserting rows.
--
-- What section 2 does is make the column TRUE for the codes both sides already
-- agree on, which is what /types needs to stop rendering 29 zeros.
--
-- LICENSE_TYPE_COUNT = 29 in lib/registry-stats.ts is flagged DISPUTED in its
-- own docblock (Build Brief says 29, the Seed Data document says 26). The
-- extract's answer is 29 DISTINCT CODES, of which only 18 are in the reference
-- taxonomy. 29 is therefore right as a count of codes in the data and wrong as a
-- description of what /types lists. Revisit that constant WITH the taxonomy
-- decision above, not before it.


-- ----------------------------------------------------------
-- 1. reference_counties — NO-OP TODAY (0 of 67 wrong)
-- ----------------------------------------------------------
--
-- Identical to 20260730's block, repeated here so one file is the whole refresh
-- maintenance step. state = 'FL' is the rule; see the note above before
-- "correcting" it.

UPDATE reference_counties rc
SET contractor_count = COALESCE(c.n, 0)
FROM (
  SELECT county_code, count(*) AS n
  FROM contractors
  WHERE state = 'FL' AND county_code IS NOT NULL
  GROUP BY county_code
) c
WHERE rc.county_code = c.county_code
  AND rc.contractor_count IS DISTINCT FROM COALESCE(c.n, 0);

-- Counties the aggregate did not reach at all, reset rather than left stale.
UPDATE reference_counties
SET contractor_count = 0
WHERE contractor_count <> 0
  AND county_code NOT IN (
    SELECT county_code FROM contractors
    WHERE state = 'FL' AND county_code IS NOT NULL
    GROUP BY county_code
  );


-- ----------------------------------------------------------
-- 2. reference_license_types — THE REAL REPAIR (18 of 29 wrong)
-- ----------------------------------------------------------
--
-- One aggregate, one pass, then a second statement to zero the rows the
-- aggregate did not reach. Sub-second: this is a GROUP BY over 266,305 rows
-- writing 29, not 29 separate counts.
--
-- NO state = 'FL' FILTER HERE, and that is a deliberate difference from the
-- county and city blocks. A county count is about Florida geography, so an
-- out-of-state registrant genuinely does not belong to one. A licence type is
-- about the licence itself — an out-of-state CGC still holds a Florida
-- Certified General Contractor licence, and /type/[code] lists them. Filtering
-- them out here would make the badge on /types disagree with the number of rows
-- the page beneath it renders.

UPDATE reference_license_types rt
SET contractor_count = COALESCE(c.n, 0)
FROM (
  SELECT license_type, count(*) AS n
  FROM contractors
  WHERE license_type IS NOT NULL
  GROUP BY license_type
) c
WHERE rt.type_code = c.license_type
  AND rt.contractor_count IS DISTINCT FROM COALESCE(c.n, 0);

-- The eleven codes with no contractors at all. Already 0 today, so this is a
-- no-op — it is here so a later refresh that retires a type resets it rather
-- than leaving a stale number behind.
UPDATE reference_license_types
SET contractor_count = 0
WHERE contractor_count <> 0
  AND type_code NOT IN (
    SELECT license_type FROM contractors
    WHERE license_type IS NOT NULL
    GROUP BY license_type
  );


-- ----------------------------------------------------------
-- 3. reference_cities — NO-OP TODAY (0 of 710 wrong)
-- ----------------------------------------------------------
--
-- Matched on upper(city_name) because contractors.city is uppercase throughout
-- the extract while reference_cities.city_name is title case.

UPDATE reference_cities rc
SET contractor_count = COALESCE(c.n, 0)
FROM (
  SELECT upper(trim(city)) AS city_key, count(*) AS n
  FROM contractors
  WHERE state = 'FL' AND city IS NOT NULL
  GROUP BY upper(trim(city))
) c
WHERE upper(rc.city_name) = c.city_key
  AND rc.contractor_count IS DISTINCT FROM COALESCE(c.n, 0);

UPDATE reference_cities
SET contractor_count = 0
WHERE contractor_count <> 0
  AND upper(city_name) NOT IN (
    SELECT upper(trim(city)) FROM contractors
    WHERE state = 'FL' AND city IS NOT NULL
    GROUP BY upper(trim(city))
  );


-- ==========================================================
-- 4. AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   SELECT type_code, type_name, contractor_count
--     FROM reference_license_types ORDER BY contractor_count DESC LIMIT 8;
--
-- Expected top rows, measured against the live extract 2026-08-05:
--
--   CGC  Certified General Contractor        38,257
--   CBC  Certified Building Contractor       19,377
--   CAC  Certified Air Conditioning Contr…   12,144
--   CCC  Certified Roofing Contractor        11,089
--   CFC  Certified Plumbing Contractor        9,110
--   CRC  Certified Residential Contractor     8,371
--   CPC  Certified Pool / Spa Contractor      4,523
--   CUC  Certified Underground Utility Co…    2,943
--   …and eleven rows still reading 0, which is correct for them.
--
--   -- the total this column now accounts for
--   SELECT sum(contractor_count) FROM reference_license_types;   --  112,254
--   SELECT count(*) FROM contractors;                            --  266,305
--
-- ⚠ THOSE TWO NUMBERS DO NOT MATCH AND SHOULD NOT BE MADE TO. The difference is
-- the 154,051 rows whose code has no reference row — QB, FRO and the nine
-- others listed above. That gap IS the taxonomy decision, and it stays visible
-- rather than being papered over.
--
--   -- counties and cities: unchanged, and that is the expected result
--   SELECT sum(contractor_count) FROM reference_counties;        --  236,285
--   SELECT count(*) FROM contractors WHERE state='FL' AND county_code IS NOT NULL;
--   -- the last two must match, and did before this file was run
--
-- MAINTENANCE: re-run this whole file after every DBPR refresh. The importer
-- does not do it — scripts/import-dbpr.mjs upserts contractors and writes its
-- sync_runs audit row, and stops there. Until that is automated, a refresh whose
-- reference counts were not repaired leaves /counties, /cities and /types
-- reporting the previous week's figures.
-- ==========================================================
