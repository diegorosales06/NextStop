-- =============================================================================
-- ASSIST articulation schema — agreements, template layout, articulation tree.
-- Depends on: institutions, academic_years (see 001_institutions.sql, 002_academic_years.sql).
-- Run in Supabase SQL editor or via psql. Idempotent.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- Extend institutions with term_type (Quarter vs Semester).
-- Populated from receivingInstitution.termType / sendingInstitution.termType.
-- Needed for cross-system unit normalization (1 qtr unit ≈ 0.667 sem units).
-- -----------------------------------------------------------------------------
ALTER TABLE institutions
    ADD COLUMN IF NOT EXISTS term_type TEXT
    CHECK (term_type IN ('Quarter', 'Semester'));

-- -----------------------------------------------------------------------------
-- agreements: one row per (sending, receiving, year, major) tuple.
-- Raw JSON kept in-row so the DB is the source of truth and re-parses need no
-- filesystem access.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agreements (
    id            BIGSERIAL PRIMARY KEY,
    key           TEXT UNIQUE NOT NULL,          -- ASSIST key "76/62/to/7/Major/<guid>"
    year_id       INT  NOT NULL REFERENCES academic_years(id),
    sending_id    INT  NOT NULL REFERENCES institutions(id),
    receiving_id  INT  NOT NULL REFERENCES institutions(id),
    major_name    TEXT NOT NULL,
    category      TEXT NOT NULL,                 -- "Major" | "GeneralEducation" | ...
    publish_date  TIMESTAMPTZ,
    catalog_year  TEXT,                          -- top-level "catalogYear" from JSON
    raw_json      JSONB NOT NULL,
    content_hash  TEXT  NOT NULL,                -- sha256 of raw_json, for change detection
    scraped_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (year_id, sending_id, receiving_id, major_name)
);

CREATE INDEX IF NOT EXISTS idx_agreements_lookup
    ON agreements (receiving_id, sending_id, year_id, category);

CREATE INDEX IF NOT EXISTS idx_agreements_sending_year
    ON agreements (sending_id, year_id);

CREATE INDEX IF NOT EXISTS idx_agreements_raw_gin
    ON agreements USING gin (raw_json jsonb_path_ops);

COMMENT ON COLUMN agreements.content_hash IS
    'SHA-256 of raw_json. Compare on re-scrape to skip unchanged agreements.';

-- -----------------------------------------------------------------------------
-- courses: deduplicated per institution by ASSIST's stable courseIdentifierParentId.
-- Used for both receiving (UC/CSU) and sending (CCC) sides.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
    id                          BIGSERIAL PRIMARY KEY,
    institution_id              INT  NOT NULL REFERENCES institutions(id),
    course_identifier_parent_id INT  NOT NULL,     -- stable ASSIST id
    prefix                      TEXT NOT NULL,     -- "MATH"
    prefix_parent_id            INT,
    course_number               TEXT NOT NULL,     -- "20D"
    title                       TEXT NOT NULL,
    department                  TEXT,
    department_parent_id        INT,
    min_units                   NUMERIC(4, 2),
    max_units                   NUMERIC(4, 2),
    begin_term                  TEXT,              -- e.g. "F2020"
    end_term                    TEXT,              -- "" while active
    UNIQUE (institution_id, course_identifier_parent_id)
);

CREATE INDEX IF NOT EXISTS idx_courses_prefix_number
    ON courses (institution_id, prefix, course_number);

CREATE INDEX IF NOT EXISTS idx_courses_title_trgm
    ON courses USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_courses_institution
    ON courses (institution_id);

COMMENT ON COLUMN courses.course_identifier_parent_id IS
    'Stable ASSIST identifier. Dedup key within an institution.';

-- -----------------------------------------------------------------------------
-- template_sections + template_cells: the receiving-side major sheet layout.
-- Sourced from raw_json.templateAssets[].sections[].rows[].cells[]. Needed to
-- answer "does this schedule complete the major?" — cells carry n-of-m rules.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS template_sections (
    id                BIGSERIAL PRIMARY KEY,
    agreement_id      BIGINT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    asset_position    INT NOT NULL,        -- index into templateAssets
    section_position  INT NOT NULL,        -- index within the RequirementGroup
    section_letter    TEXT,                -- "A", "B", ... when hide_letters=false
    hide_letters      BOOLEAN NOT NULL DEFAULT false,
    instruction       TEXT,                -- e.g. "Complete 2 of the following"
    attributes        JSONB,               -- raw ASSIST attributes (n-of-m rules)
    UNIQUE (agreement_id, asset_position, section_position)
);

CREATE INDEX IF NOT EXISTS idx_template_sections_agreement
    ON template_sections (agreement_id);

CREATE TABLE IF NOT EXISTS template_cells (
    id                BIGSERIAL PRIMARY KEY,
    section_id        BIGINT NOT NULL REFERENCES template_sections(id) ON DELETE CASCADE,
    template_cell_id  TEXT UNIQUE NOT NULL,       -- ASSIST GUID; joined by articulation_entries
    row_position      INT NOT NULL,
    cell_position     INT NOT NULL,
    cell_type         TEXT NOT NULL               -- "Course" | "Series" | "GeneralEducation" | ...
);

CREATE INDEX IF NOT EXISTS idx_template_cells_section
    ON template_cells (section_id);

-- -----------------------------------------------------------------------------
-- articulation_entries: one row per receiving requirement in an agreement.
-- Joined to a template cell by the ASSIST-assigned template_cell_id GUID.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articulation_entries (
    id                      BIGSERIAL PRIMARY KEY,
    agreement_id            BIGINT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    template_cell_id        TEXT   NOT NULL REFERENCES template_cells(template_cell_id),
    entry_type              TEXT   NOT NULL,      -- "Course" | "Series" | "GeneralEducation"
    no_articulation_reason  TEXT                  -- populated when nothing articulates
);

CREATE INDEX IF NOT EXISTS idx_articulation_entries_agreement
    ON articulation_entries (agreement_id);

CREATE INDEX IF NOT EXISTS idx_articulation_entries_cell
    ON articulation_entries (template_cell_id);

-- -----------------------------------------------------------------------------
-- articulation_entry_receiving_courses: N receiving courses per entry.
-- One row for a plain Course entry; multiple rows for a Series (CHEM 6A+6B+6C).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articulation_entry_receiving_courses (
    id           BIGSERIAL PRIMARY KEY,
    entry_id     BIGINT NOT NULL REFERENCES articulation_entries(id) ON DELETE CASCADE,
    course_id    BIGINT NOT NULL REFERENCES courses(id),
    position     INT NOT NULL,
    conjunction  TEXT,                          -- "And" for series continuation; NULL for single
    UNIQUE (entry_id, position)
);

CREATE INDEX IF NOT EXISTS idx_entry_receiving_courses_course
    ON articulation_entry_receiving_courses (course_id);

-- -----------------------------------------------------------------------------
-- sending_groups + sending_group_courses: the (A AND B) OR (C) tree.
-- Sourced from raw_json.articulations[].articulation.sendingArticulation.items[].
-- Each item is a CourseGroup (an OR-branch); each nested item is a Course (AND-joined).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sending_groups (
    id                     BIGSERIAL PRIMARY KEY,
    articulation_entry_id  BIGINT NOT NULL REFERENCES articulation_entries(id) ON DELETE CASCADE,
    group_order            INT NOT NULL,
    group_conjunction      TEXT,                    -- see comment below
    UNIQUE (articulation_entry_id, group_order)
);

CREATE INDEX IF NOT EXISTS idx_sending_groups_entry
    ON sending_groups (articulation_entry_id);

COMMENT ON COLUMN sending_groups.group_conjunction IS
    'Conjunction joining THIS group to the PREVIOUS group (from ASSIST courseConjunction). Ignored when group_order = 0.';

CREATE TABLE IF NOT EXISTS sending_group_courses (
    id            BIGSERIAL PRIMARY KEY,
    group_id      BIGINT NOT NULL REFERENCES sending_groups(id) ON DELETE CASCADE,
    course_id     BIGINT NOT NULL REFERENCES courses(id),
    course_order  INT NOT NULL,
    UNIQUE (group_id, course_order)
);

CREATE INDEX IF NOT EXISTS idx_sending_group_courses_course
    ON sending_group_courses (course_id);

CREATE INDEX IF NOT EXISTS idx_sending_group_courses_group
    ON sending_group_courses (group_id);

-- -----------------------------------------------------------------------------
-- denied_courses: sending courses that USED to articulate but no longer do.
-- Sourced from raw_json.articulations[].articulation.sendingArticulation.deniedCourses.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS denied_courses (
    id         BIGSERIAL PRIMARY KEY,
    entry_id   BIGINT NOT NULL REFERENCES articulation_entries(id) ON DELETE CASCADE,
    course_id  BIGINT NOT NULL REFERENCES courses(id),
    UNIQUE (entry_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_denied_courses_course
    ON denied_courses (course_id);

-- -----------------------------------------------------------------------------
-- cross_listed: institution-global cross-listings (e.g. UCSD CSE 8B ≡ MAE 8).
-- Symmetric; stored once via canonical ordering (course_a_id < course_b_id).
-- Query both directions when looking up.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cross_listed (
    id           BIGSERIAL PRIMARY KEY,
    course_a_id  BIGINT NOT NULL REFERENCES courses(id),
    course_b_id  BIGINT NOT NULL REFERENCES courses(id),
    CHECK (course_a_id < course_b_id),
    UNIQUE (course_a_id, course_b_id)
);

CREATE INDEX IF NOT EXISTS idx_cross_listed_a ON cross_listed (course_a_id);
CREATE INDEX IF NOT EXISTS idx_cross_listed_b ON cross_listed (course_b_id);

COMMENT ON COLUMN cross_listed.course_a_id IS
    'Canonical ordering: course_a_id < course_b_id. Query both directions when searching.';

-- -----------------------------------------------------------------------------
-- Reverse-lookup materialized view: given a receiving course, which sending
-- courses articulate to it (and vice versa). Powers "find classes at other CCs"
-- and "what does this CC class transfer as?" without a 5-table join.
--
-- Refresh after each scrape load:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY course_articulates_to;
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS course_articulates_to AS
SELECT DISTINCT
    sgc.course_id     AS sending_course_id,
    aerc.course_id    AS receiving_course_id,
    a.id              AS agreement_id,
    a.sending_id,
    a.receiving_id,
    a.year_id,
    a.major_name
FROM sending_group_courses sgc
JOIN sending_groups sg                          ON sg.id = sgc.group_id
JOIN articulation_entries ae                    ON ae.id = sg.articulation_entry_id
JOIN articulation_entry_receiving_courses aerc  ON aerc.entry_id = ae.id
JOIN agreements a                               ON a.id = ae.agreement_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_articulates_to_unique
    ON course_articulates_to (sending_course_id, receiving_course_id, agreement_id);

CREATE INDEX IF NOT EXISTS idx_course_articulates_to_receiving
    ON course_articulates_to (receiving_course_id, year_id);

CREATE INDEX IF NOT EXISTS idx_course_articulates_to_sending
    ON course_articulates_to (sending_course_id, year_id);

COMMIT;

-- =============================================================================
-- Post-load: refresh the materialized view after upserting agreements + entries:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY course_articulates_to;
-- The CONCURRENTLY variant needs the unique index above and must run outside
-- the load transaction.
-- =============================================================================

-- =============================================================================
-- Supabase note: PostgREST auto-exposes these tables. Before shipping a web
-- app, enable RLS and add read-only policies:
--
--   ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "public read" ON agreements FOR SELECT USING (true);
--   -- repeat for each table intended to be readable by the anon key
--
-- Or keep everything behind a service_role key and query through a backend.
-- =============================================================================
