-- ==========================================================
-- reference_cities.city_name_raw
-- 2026-07-29
--
-- Run in the Supabase SQL editor BEFORE deriving reference_cities from the
-- imported contractor data.
--
-- Second migration of the DBPR import work; the first was
-- 2026-07-29_dbpr_import_prep.sql.
-- ==========================================================


-- ----------------------------------------------------------
-- city_name_raw — the ALL-CAPS source form
--
-- contractors.city holds exactly what DBPR published: "DAVIE",
-- "ST. PETERSBURG", "N MIAMI BEACH". reference_cities.city_name will hold the
-- title-cased display form ("Davie", "St. Petersburg"), so without this column
-- there is no stored value that joins the two tables — every join would have
-- to re-uppercase city_name at query time and hope the transform round-trips.
-- It does not round-trip reliably: "Ponce de Leon" upper-cases to
-- "PONCE DE LEON" but "McIntosh" gives "MCINTOSH", and the 22 slug-merged
-- groups have several source spellings mapping to one display name.
--
-- Same reasoning as contractors.license_number_raw: keep the source form when
-- the derived form is lossy, rather than trying to reconstruct it later.
--
-- NULLABLE by design. For the 22 groups where several ALL-CAPS spellings
-- collapse to one slug (ST. PETERSBURG / ST PETERSBURG / ST.PETERSBURG /
-- ST  PETERSBURG all become st-petersburg), this stores the single
-- highest-count spelling. The other spellings are recorded only in
-- contractors.city, which remains the complete record.
-- ----------------------------------------------------------
ALTER TABLE reference_cities ADD COLUMN IF NOT EXISTS city_name_raw text;

COMMENT ON COLUMN reference_cities.city_name_raw IS
  'ALL-CAPS source spelling as published by DBPR, e.g. "ST. PETERSBURG". '
  'Join key to contractors.city. Where several spellings share a slug, this '
  'holds the highest-count one; contractors.city keeps them all.';

COMMENT ON COLUMN reference_cities.city_name IS
  'Title-cased display form, e.g. "St. Petersburg". Casing only — '
  'abbreviations are NOT expanded, so "FT MYERS" becomes "Ft Myers", not '
  '"Fort Myers". Expanding them is a separate normalisation task with SEO '
  'consequences (which spelling owns /city/fort-myers).';

COMMENT ON COLUMN reference_cities.county_code IS
  'MODAL county for this city — the county holding the most contractors of '
  'that name. Unambiguous for 1,716 of 1,778 names (one county holds >=90%). '
  'For the 62 genuinely split cities (Lutz spans Hillsborough/Pasco, Spring '
  'Hill spans Hernando/Pasco, Englewood spans Sarasota/Charlotte) this loses '
  'the minority county; a city_county_overrides table is planned to carry it.';

COMMENT ON COLUMN reference_cities.contractor_count IS
  'Contractors whose city matches this row, summed across every source '
  'spelling that maps to this slug. Denormalised; refresh via '
  'refresh_city_contractor_counts() after each DBPR sync.';

COMMENT ON COLUMN reference_cities.latitude IS
  'NULL for every row derived from the DBPR extract — it publishes no '
  'coordinates. The /counties nearest-first geolocation feature is blocked '
  'until a coordinate source is added.';
