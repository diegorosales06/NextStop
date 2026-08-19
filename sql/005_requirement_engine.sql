-- =============================================================================
-- Requirement engine — three SQL functions that answer the app's core questions.
--
-- All functions are SECURITY INVOKER (default) so RLS is respected. Public-browse
-- callers use the *_for_courses variants and pass in raw course_id arrays;
-- signed-in callers use the *_for_schedule variants that read from schedules
-- they own.
--
-- Depends on: articulation_entries, sending_groups, sending_group_courses,
--             articulation_entry_receiving_courses, courses, schedules,
--             schedule_courses, agreements.
-- Run in Supabase SQL editor. Idempotent.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. is_entry_satisfied(entry_id, taken_course_ids)
--
--    Boolean: does the taken-course set satisfy this one articulation entry?
--
--    An entry has 1..N sending groups. Each group is satisfied when EVERY
--    course inside it (sending_group_courses) is in the taken set — that's
--    the AND. Groups are joined left-to-right via their group_conjunction
--    ("Or" is the common case; "And" appears in rare multi-group requirements).
--
--    Caveat: left-to-right evaluation without operator precedence. In the
--    dataset today (Mt.SAC → UCSD/UCLA), 100% of entries are either single-
--    group or all-OR, so this matches ASSIST's own rendering. If you ever
--    see mixed AND/OR at the group level, verify against the ASSIST UI.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_entry_satisfied(
    p_entry_id BIGINT,
    p_taken_course_ids BIGINT[]
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_group           RECORD;
    v_group_satisfied BOOLEAN;
    v_result          BOOLEAN := NULL;
    v_missing         INT;
BEGIN
    IF p_taken_course_ids IS NULL THEN
        p_taken_course_ids := ARRAY[]::BIGINT[];
    END IF;

    FOR v_group IN
        SELECT id, group_order, group_conjunction
        FROM sending_groups
        WHERE articulation_entry_id = p_entry_id
        ORDER BY group_order
    LOOP
        SELECT count(*) INTO v_missing
        FROM sending_group_courses sgc
        WHERE sgc.group_id = v_group.id
          AND NOT (sgc.course_id = ANY(p_taken_course_ids));

        v_group_satisfied := (v_missing = 0);

        IF v_result IS NULL THEN
            v_result := v_group_satisfied;
        ELSIF v_group.group_conjunction = 'And' THEN
            v_result := v_result AND v_group_satisfied;
        ELSE  -- 'Or' or NULL default to OR
            v_result := v_result OR v_group_satisfied;
        END IF;
    END LOOP;

    RETURN COALESCE(v_result, FALSE);
END;
$$;

COMMENT ON FUNCTION is_entry_satisfied IS
    'Returns true if the given course set satisfies the sending-side requirement of one articulation_entry.';


-- -----------------------------------------------------------------------------
-- 2. check_agreement_for_courses(course_ids, agreement_id)
--
--    Given a list of CC courses the student has (or plans to have) and one
--    agreement, return a table with per-requirement status. This is the
--    "how does my schedule stack up against UCSD CS?" query.
--
--    Public callers use this directly; signed-in callers should use
--    check_agreement_for_schedule() below.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_agreement_for_courses(
    p_course_ids   BIGINT[],
    p_agreement_id BIGINT
) RETURNS TABLE (
    entry_id             BIGINT,
    template_cell_id     TEXT,
    entry_type           TEXT,
    receiving_summary    TEXT,     -- e.g. "MATH 20A" or "CHEM 6A + 6B + 6C"
    receiving_courses    JSONB,    -- full detail: [{course_id, prefix, number, title, units}]
    satisfied            BOOLEAN,
    no_articulation_reason TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        ae.id,
        ae.template_cell_id,
        ae.entry_type,
        rc.summary,
        rc.courses,
        is_entry_satisfied(ae.id, p_course_ids),
        ae.no_articulation_reason
    FROM articulation_entries ae
    LEFT JOIN LATERAL (
        SELECT
            -- Compact display: elide repeated prefix when every course
            -- shares it (Series usually do → "PHYSICS 1A + 1B + 1C"), fall
            -- back to explicit prefixes when they differ.
            CASE
                WHEN count(DISTINCT c.prefix) = 1 THEN
                    min(c.prefix) || ' ' ||
                    string_agg(c.course_number, ' + ' ORDER BY aerc.position)
                ELSE
                    string_agg(c.prefix || ' ' || c.course_number,
                               ' + ' ORDER BY aerc.position)
            END AS summary,
            jsonb_agg(jsonb_build_object(
                'course_id',  c.id,
                'prefix',     c.prefix,
                'number',     c.course_number,
                'title',      c.title,
                'min_units',  c.min_units,
                'max_units',  c.max_units
            ) ORDER BY aerc.position) AS courses
        FROM articulation_entry_receiving_courses aerc
        JOIN courses c ON c.id = aerc.course_id
        WHERE aerc.entry_id = ae.id
    ) rc ON TRUE
    WHERE ae.agreement_id = p_agreement_id
    ORDER BY ae.id;
$$;

COMMENT ON FUNCTION check_agreement_for_courses IS
    'Per-requirement status for one agreement against a course set. Public-safe.';


-- -----------------------------------------------------------------------------
-- 3. check_agreement_for_schedule(schedule_id, agreement_id)
--
--    Thin wrapper: pulls the schedule's course_ids, then delegates. RLS on
--    schedule_courses gates access — passing another user's schedule_id
--    returns zero rows rather than leaking data.
--
--    By default counts completed + in_progress + planned. Change the WHERE
--    clause on the CTE if you want a stricter definition (e.g. completed only).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_agreement_for_schedule(
    p_schedule_id  BIGINT,
    p_agreement_id BIGINT
) RETURNS TABLE (
    entry_id             BIGINT,
    template_cell_id     TEXT,
    entry_type           TEXT,
    receiving_summary    TEXT,
    receiving_courses    JSONB,
    satisfied            BOOLEAN,
    no_articulation_reason TEXT
)
LANGUAGE sql
STABLE
AS $$
    WITH taken AS (
        SELECT array_agg(course_id) AS ids
        FROM schedule_courses
        WHERE schedule_id = p_schedule_id
    )
    SELECT * FROM check_agreement_for_courses(
        COALESCE((SELECT ids FROM taken), ARRAY[]::BIGINT[]),
        p_agreement_id
    );
$$;


-- -----------------------------------------------------------------------------
-- 4. rank_agreements_for_courses(course_ids, ...)
--
--    "Given my courses, which majors am I closest to completing?"
--    The headline query — powers the "put in your classes, see matching schools"
--    feature. Filter by receiving institution(s), year, and category if desired.
--
--    Returns one row per agreement with satisfied/total counts and a
--    completion percentage, ordered by completion desc.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rank_agreements_for_courses(
    p_course_ids     BIGINT[],
    p_receiving_ids  INT[]  DEFAULT NULL,   -- NULL = all
    p_year_id        INT    DEFAULT NULL,   -- NULL = all years
    p_category       TEXT   DEFAULT 'Major',
    p_limit          INT    DEFAULT 50
) RETURNS TABLE (
    agreement_id       BIGINT,
    receiving_id       INT,
    receiving_name     TEXT,
    major_name         TEXT,
    year_id            INT,
    total_entries      BIGINT,
    satisfied_entries  BIGINT,
    completion_pct     NUMERIC
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        a.id,
        a.receiving_id,
        i.name,
        a.major_name,
        a.year_id,
        count(ae.id)                                    AS total_entries,
        count(ae.id) FILTER (WHERE is_entry_satisfied(ae.id, p_course_ids))
                                                        AS satisfied_entries,
        round(
            100.0 * count(ae.id) FILTER (WHERE is_entry_satisfied(ae.id, p_course_ids))
                 / NULLIF(count(ae.id), 0),
            1
        )                                               AS completion_pct
    FROM agreements a
    JOIN institutions i        ON i.id = a.receiving_id
    JOIN articulation_entries ae ON ae.agreement_id = a.id
    WHERE (p_receiving_ids IS NULL OR a.receiving_id = ANY(p_receiving_ids))
      AND (p_year_id       IS NULL OR a.year_id = p_year_id)
      AND (p_category      IS NULL OR a.category = p_category)
    GROUP BY a.id, a.receiving_id, i.name, a.major_name, a.year_id
    ORDER BY completion_pct DESC NULLS LAST, total_entries DESC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION rank_agreements_for_courses IS
    'Ranks agreements by fraction-of-requirements-satisfied for the given course set. Public-safe.';


-- -----------------------------------------------------------------------------
-- 5. rank_agreements_for_schedule(schedule_id, ...)
--
--    Same as (4), but reads the courses from an owned schedule.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rank_agreements_for_schedule(
    p_schedule_id    BIGINT,
    p_receiving_ids  INT[]  DEFAULT NULL,
    p_year_id        INT    DEFAULT NULL,
    p_category       TEXT   DEFAULT 'Major',
    p_limit          INT    DEFAULT 50
) RETURNS TABLE (
    agreement_id       BIGINT,
    receiving_id       INT,
    receiving_name     TEXT,
    major_name         TEXT,
    year_id            INT,
    total_entries      BIGINT,
    satisfied_entries  BIGINT,
    completion_pct     NUMERIC
)
LANGUAGE sql
STABLE
AS $$
    WITH taken AS (
        SELECT array_agg(course_id) AS ids
        FROM schedule_courses
        WHERE schedule_id = p_schedule_id
    )
    SELECT * FROM rank_agreements_for_courses(
        COALESCE((SELECT ids FROM taken), ARRAY[]::BIGINT[]),
        p_receiving_ids, p_year_id, p_category, p_limit
    );
$$;

COMMIT;

-- =============================================================================
-- Usage examples (paste into the SQL editor):
--
--   -- What CC courses satisfy UCSD's MATH 20A requirement?
--   SELECT * FROM check_agreement_for_courses(
--       ARRAY[]::BIGINT[],    -- no courses = shows every entry as unsatisfied
--       (SELECT id FROM agreements
--        WHERE receiving_id = 7 AND major_name ILIKE '%Computer Science%'
--        LIMIT 1)
--   );
--
--   -- "I've taken MTSAC MATH 180 and MATH 181. Which UC majors am I closest to?"
--   SELECT * FROM rank_agreements_for_courses(
--       (SELECT array_agg(id) FROM courses
--        WHERE institution_id = 62
--          AND prefix = 'MATH'
--          AND course_number IN ('180','181')),
--       p_year_id => 76
--   );
--
--   -- Signed-in equivalent (respects RLS — must own the schedule):
--   SELECT * FROM rank_agreements_for_schedule(
--       (SELECT id FROM schedules WHERE user_id = auth.uid() AND is_primary),
--       p_year_id => 76
--   );
--
-- Calling from the app:
--   const { data } = await supabase.rpc('rank_agreements_for_schedule', {
--       p_schedule_id: myScheduleId,
--       p_year_id: 76
--   })
-- =============================================================================


-- =============================================================================
-- When to migrate this to backend code:
--
-- These functions cover: single-course, Series (via satisfies-all-groups),
-- Requirement (returns unsatisfied — no courses linked), simple OR/AND groups.
--
-- Move to backend (Next.js API route or Supabase Edge Function) when you add:
--   - "Complete 2 of the following 4 sections" (n-of-m from templateAssets.attributes)
--   - Unit-based rules ("15 units from group X")
--   - Grade minimums, GPA thresholds
--   - Cross-listed course substitution
--   - IGETC / general-education overlays
--
-- All of those need template_sections.attributes parsing that's easier in JS/TS
-- than PL/pgSQL. Until then, keep it in SQL — one round trip, no ORM friction.
-- =============================================================================
