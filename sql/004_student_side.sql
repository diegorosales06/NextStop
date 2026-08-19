-- =============================================================================
-- Student-side schema — profiles, schedules, saved agreements + RLS.
-- Depends on: auth.users (Supabase built-in), institutions, agreements, courses.
-- Assumes Google OAuth is configured in Dashboard → Authentication → Providers.
-- Run in Supabase SQL editor. Idempotent.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Enable RLS on ASSIST tables (public read; nobody writes via the anon key).
--    All the writing goes through the Python loader with the service_role key,
--    which bypasses RLS.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'institutions', 'academic_years', 'agreements',
        'template_sections', 'template_cells',
        'articulation_entries', 'articulation_entry_receiving_courses',
        'sending_groups', 'sending_group_courses',
        'denied_courses', 'cross_listed', 'courses'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "public read" ON %I', t);
        EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)', t);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. profiles — one row per authenticated user; created automatically on sign-up.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    avatar_url   TEXT,
    home_cc_id   INT REFERENCES institutions(id),  -- current community college
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_home_cc ON profiles (home_cc_id);

-- Auto-create a profile row when someone signs up (Google OAuth or otherwise).
-- raw_user_meta_data comes from the OAuth provider; Google fills "full_name"
-- and "avatar_url".
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name',
                 NEW.raw_user_meta_data->>'name'),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- -----------------------------------------------------------------------------
-- 3. schedules — a user can have multiple named schedules ("Fall 26 plan",
--    "Plan B with physics"). One is marked primary for the default view.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    notes       TEXT,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules (user_id);

-- Only one primary schedule per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_one_primary
    ON schedules (user_id) WHERE is_primary;

-- -----------------------------------------------------------------------------
-- 4. schedule_courses — the actual courses in a schedule.
--    status distinguishes what the requirement engine should count:
--      completed / in_progress → satisfies requirements now
--      planned                 → satisfies requirements after completion
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_courses (
    id           BIGSERIAL PRIMARY KEY,
    schedule_id  BIGINT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    course_id    BIGINT NOT NULL REFERENCES courses(id),
    status       TEXT NOT NULL CHECK (status IN ('completed', 'in_progress', 'planned')),
    term         TEXT,           -- "Fall 2025" (free-form; keep flexible)
    grade        TEXT,           -- "A", "B+", "P" — nullable
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (schedule_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_courses_schedule
    ON schedule_courses (schedule_id);

CREATE INDEX IF NOT EXISTS idx_schedule_courses_course
    ON schedule_courses (course_id);

-- -----------------------------------------------------------------------------
-- 5. saved_agreements — transfer targets ("I want to go to UCSD CS").
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_agreements (
    id            BIGSERIAL PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agreement_id  BIGINT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, agreement_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_agreements_user
    ON saved_agreements (user_id);

-- -----------------------------------------------------------------------------
-- 6. updated_at auto-touch trigger (used by profiles and schedules).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_touch ON profiles;
CREATE TRIGGER trg_profiles_touch
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_schedules_touch ON schedules;
CREATE TRIGGER trg_schedules_touch
    BEFORE UPDATE ON schedules
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- -----------------------------------------------------------------------------
-- 7. RLS on student-side tables — a user only ever sees their own rows.
-- -----------------------------------------------------------------------------

-- profiles: you can read anyone's profile (in case you want public profiles
-- for shared schedules later), but you can only insert/update your own.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles read all"     ON profiles;
DROP POLICY IF EXISTS "profiles update own"   ON profiles;
DROP POLICY IF EXISTS "profiles insert own"   ON profiles;
CREATE POLICY "profiles read all"   ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles insert own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles update own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- schedules: fully private per user.
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedules own" ON schedules;
CREATE POLICY "schedules own" ON schedules
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- schedule_courses: joined through the parent schedule.
ALTER TABLE schedule_courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedule_courses own" ON schedule_courses;
CREATE POLICY "schedule_courses own" ON schedule_courses
    USING (
        EXISTS (SELECT 1 FROM schedules s
                WHERE s.id = schedule_courses.schedule_id
                  AND s.user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM schedules s
                WHERE s.id = schedule_courses.schedule_id
                  AND s.user_id = auth.uid())
    );

-- saved_agreements: fully private per user.
ALTER TABLE saved_agreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saved_agreements own" ON saved_agreements;
CREATE POLICY "saved_agreements own" ON saved_agreements
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

COMMIT;

-- =============================================================================
-- Post-setup — configure Google OAuth in the Supabase Dashboard:
--
--   1. Google Cloud Console → APIs & Services → Credentials
--      → Create OAuth 2.0 Client ID (type: Web application)
--      → Authorized redirect URI:
--          https://<your-project-ref>.supabase.co/auth/v1/callback
--      → Copy client ID + client secret
--
--   2. Supabase Dashboard → Authentication → Providers → Google
--      → Enable, paste the client ID + secret, Save
--
--   3. From the app (JS):
--      const { data, error } = await supabase.auth.signInWithOAuth({
--          provider: 'google',
--          options: { redirectTo: window.location.origin + '/auth/callback' }
--      })
--
-- The handle_new_user() trigger runs automatically on first sign-in and
-- creates the matching profiles row.
-- =============================================================================
