-- =============================================================================
-- articulates_to.sql — "what does this CC course transfer to?"
--
-- The query I ran to sanity-check the load. Uses the reverse-lookup
-- materialized view (course_articulates_to) so no 5-table join is needed.
--
-- Paste into the Supabase SQL editor. Edit the params block, then Run.
-- =============================================================================

WITH params AS (
    SELECT
        -- Filter by SENDING side (the community college and its course).
        -- Set any of these to NULL to drop the filter.
        62::INT       AS sending_institution_id,   -- 62 = Mt. SAC; NULL = any CC
        'MATH'::TEXT  AS sending_prefix,           -- e.g. 'MATH', 'PHYS'; NULL = any
        NULL::TEXT    AS sending_number,           -- e.g. '180'; NULL = any

        -- Filter by RECEIVING side (the 4-year and its course).
        NULL::INT     AS receiving_institution_id, -- 7 = UCSD, 117 = UCLA; NULL = any
        NULL::TEXT    AS receiving_prefix,         -- NULL = any
        NULL::TEXT    AS receiving_number,         -- NULL = any

        -- Filter by academic year and by major.
        76::INT       AS year_id,                  -- 76 = 2026-27; NULL = any year
        NULL::TEXT    AS major_ilike,              -- e.g. '%computer science%'; NULL = any

        50::INT       AS limit_rows
)
SELECT
    c_send.prefix || ' ' || c_send.course_number     AS sending_course,
    c_send.title                                     AS sending_title,
    i_recv.name                                      AS receiving_school,
    c_recv.prefix || ' ' || c_recv.course_number     AS receiving_course,
    c_recv.title                                     AS receiving_title,
    a.major_name,
    ay.from_year || '-' || ay.to_year                AS year
FROM course_articulates_to cat
JOIN courses         c_send ON c_send.id = cat.sending_course_id
JOIN courses         c_recv ON c_recv.id = cat.receiving_course_id
JOIN agreements      a      ON a.id      = cat.agreement_id
JOIN institutions    i_send ON i_send.id = cat.sending_id
JOIN institutions    i_recv ON i_recv.id = cat.receiving_id
JOIN academic_years  ay     ON ay.id     = cat.year_id
CROSS JOIN params p
WHERE (p.sending_institution_id   IS NULL OR c_send.institution_id = p.sending_institution_id)
  AND (p.sending_prefix           IS NULL OR c_send.prefix         = p.sending_prefix)
  AND (p.sending_number           IS NULL OR c_send.course_number  = p.sending_number)
  AND (p.receiving_institution_id IS NULL OR cat.receiving_id      = p.receiving_institution_id)
  AND (p.receiving_prefix         IS NULL OR c_recv.prefix         = p.receiving_prefix)
  AND (p.receiving_number         IS NULL OR c_recv.course_number  = p.receiving_number)
  AND (p.year_id                  IS NULL OR cat.year_id           = p.year_id)
  AND (p.major_ilike              IS NULL OR a.major_name          ILIKE p.major_ilike)
ORDER BY
    c_send.prefix,
    c_send.course_number,
    i_recv.name,
    a.major_name
LIMIT (SELECT limit_rows FROM params);


-- =============================================================================
-- Edit knobs — everything above the SELECT is safe to change; the WHERE clause
-- ignores any param that's NULL, so drop filters by NULL-ing them out.
--
-- Common recipes (edit the params block, don't touch the WHERE):
--
--   "Everything from Mt. SAC MATH 180":
--       sending_institution_id = 62
--       sending_prefix         = 'MATH'
--       sending_number         = '180'
--
--   "What CC courses satisfy UCSD's MATH 20A?":
--       sending_institution_id = NULL
--       sending_prefix         = NULL
--       receiving_institution_id = 7
--       receiving_prefix       = 'MATH'
--       receiving_number       = '20A'
--
--   "All CS-major articulations from Mt. SAC to UCLA":
--       sending_institution_id   = 62
--       receiving_institution_id = 117
--       major_ilike              = '%computer science%'
--       sending_prefix           = NULL
--
--   "Everything for 2026-27, capped at 500 rows":
--       year_id    = 76
--       limit_rows = 500
--       (all other params NULL)
-- =============================================================================


-- =============================================================================
-- Useful IDs (from the MVP roster in mvp_config.py):
--
--   Community colleges (sending):
--     62  Mt. SAC          64  Rio Hondo       49  Pasadena
--    113  De Anza         137  Santa Monica   134  Fullerton
--
--   Four-year schools (receiving):
--      7  UCSD           117  UCLA            79  UC Berkeley
--     89  UC Davis       120  UC Irvine       46  UC Riverside
--    128  UC Santa Barbara  132  UC Santa Cruz  144  UC Merced
--     11  Cal Poly SLO    75  Cal Poly Pomona
--    129  CSU Fullerton   81  CSU Long Beach
--
--   Academic years (see academic_years table for the full list):
--     76  2026-27
--
-- Look up any institution: SELECT id, name, code FROM institutions ORDER BY name;
-- =============================================================================
