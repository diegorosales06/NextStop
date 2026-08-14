-- Academic years from ASSIST. Reference DDL — the table already exists
-- in Supabase. `from_year` is ASSIST's `fallYear`; `to_year` is fallYear+1.
CREATE TABLE IF NOT EXISTS academic_years (
    id         INT PRIMARY KEY,
    from_year  INT,
    to_year    INT
);
