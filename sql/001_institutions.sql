-- Institutions from ASSIST. Reference DDL — the table already exists in
-- Supabase. Kept here so the schema lives with the code.
CREATE TABLE IF NOT EXISTS institutions (
    id           INT PRIMARY KEY,        -- ASSIST's ID (stable, never changes)
    code         TEXT NOT NULL,          -- e.g. "UCSD", "MTSAC", "CSULB"
    name         TEXT NOT NULL,          -- Full name: "University of California, San Diego"
    category     TEXT NOT NULL,          -- "CCC" | "UC" | "CSU" | "private" | "other"
    is_community BOOLEAN NOT NULL        -- Convenience flag: TRUE if category='CCC'
);
