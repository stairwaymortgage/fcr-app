-- ==========================================================
-- reference_cities.contractor_count — coverage note
-- 2026-07-30
--
-- COMMENT ONLY. No DDL, no data change. Safe to run at any time.
--
-- Third and last migration of the DBPR import work. The first two were
-- 2026-07-29_dbpr_import_prep.sql and 2026-07-29_city_name_raw.sql.
-- ==========================================================


-- ----------------------------------------------------------
-- CITY COUNTS DO NOT SUM TO THE SITE TOTAL. THIS IS BY DESIGN.
--
-- SUM(reference_cities.contractor_count) = 234,881
-- COUNT(*) FROM contractors             = 266,305
--                                   gap =  31,424
--
-- The gap is three deliberate exclusions, none of them a bug:
--
--   27,220  contractors have a city but NO county_code. 27,099 of those are
--           registered outside Florida (Atlanta, Houston, Charlotte). A row
--           in reference_cities requires a county_code — it is NOT NULL and a
--           foreign key — so out-of-state contractors have no city row to
--           belong to.
--
--    2,673  contractors have no city at all. DBPR published the licence with
--           no city value.
--
--   ~1,531  contractors whose city spelling fell below the 5-contractor floor
--           applied when reference_cities was derived. Those spellings are
--           overwhelmingly typos and truncations — JACSONVILLE, WESLY CHAPEL,
--           "ROCKLEDGE, FL", "PORT ST" — and each one would otherwise have
--           generated a public /city/ page.
--
-- So a contractor can exist without appearing in any city's count, and the
-- sum of all city counts will always be lower than the contractor total.
--
-- If a future check compares the two and reports a discrepancy, the check is
-- wrong, not the data. The correct assertion is:
--
--   SUM(reference_cities.contractor_count)
--     = COUNT(*) FROM contractors
--       WHERE city IS NOT NULL
--         AND county_code IS NOT NULL
--         AND city matches a spelling that cleared the floor
--
-- Recorded here because reference_cities.contractor_count is where someone
-- doing Week 2 or Week 3 work will look first.
-- ----------------------------------------------------------

COMMENT ON COLUMN reference_cities.contractor_count IS
  'Contractors whose city matches this row, summed across every source '
  'spelling that maps to this slug. Denormalised; refresh via '
  'refresh_city_contractor_counts() after each DBPR sync. '
  'CITY COUNTS DO NOT SUM TO THE CONTRACTOR TOTAL BY DESIGN: 234,881 of '
  '266,305 are covered. The 31,424 excluded are 27,220 with no county '
  '(27,099 out-of-state), 2,673 with no city, and ~1,531 whose city spelling '
  'fell below the 5-contractor floor (typos such as JACSONVILLE). A check '
  'comparing the two totals is wrong, not the data.';
