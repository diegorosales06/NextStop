# NextStop — Web

Next.js 16 (App Router) + Supabase for the transfer-planner UI.

## First-time setup

```bash
# 1. Install deps
npm install

# 2. Copy env template and fill in from Supabase Dashboard → Project Settings → API
cp .env.local.example .env.local
$EDITOR .env.local

# 3. Set up Google OAuth (one-time, ~5 min)
#    a. Google Cloud Console → APIs & Services → Credentials
#       → Create OAuth 2.0 Client ID (Web application)
#       → Authorized redirect URI:
#         https://<your-project-ref>.supabase.co/auth/v1/callback
#    b. Supabase Dashboard → Authentication → Providers → Google
#       → Enable, paste client ID + secret, Save
#    c. Also add http://localhost:3000/auth/callback to Supabase
#       → Authentication → URL Configuration → Redirect URLs

# 4. Run
npm run dev
# → http://localhost:3000
```

## Regenerating DB types

The `src/lib/database.types.ts` file is hand-crafted to match the schema in
`../sql/001..005*.sql`. When the schema changes, regenerate with the
Supabase CLI:

```bash
# One-time — install the CLI
brew install supabase/tap/supabase

# Log in and link the project
supabase login
supabase link --project-ref $SUPABASE_PROJECT_REF

# Regenerate
npm run types
```

The RPC (`Functions`) types come out less friendly from the generator than
the hand-written ones — copy them back from git if the generated version
loses argument names.

## Layout

```
src/
  app/
    layout.tsx              # root layout
    page.tsx                # landing (public)
    globals.css             # design tokens (light + dark)
    auth/
      callback/route.ts     # OAuth handler
      error/page.tsx        # OAuth failure page
    schedule/page.tsx       # user schedule (auth-required stub)
    majors/
      page.tsx              # ranked majors (calls rank_agreements_for_courses)
      [id]/page.tsx         # per-major requirement checklist
    saved/page.tsx          # saved targets (auth-required stub)
  components/
    Header.tsx              # site header, reads current user
    GoogleSignInButton.tsx  # client-side OAuth trigger
    SignOutButton.tsx       # client-side sign-out
  lib/
    supabase/
      client.ts             # browser client
      server.ts             # server-component client
      middleware.ts         # session-refresh helper
    database.types.ts       # DB row + RPC types
    mvp.ts                  # MVP roster constants (in sync with ../mvp_config.py)
middleware.ts               # Next middleware — refreshes auth cookies
```

## Where things are wired vs. still to do

**Working end-to-end:**
- Google OAuth sign-in / sign-out (once you configure the provider in step 3)
- Landing page reads live agreement count from Supabase
- `/majors` calls `rank_agreements_for_courses` RPC and renders the ranking
- `/majors/[id]` calls `check_agreement_for_courses` and renders the requirement checklist

**Scaffolded (renders, but not yet interactive):**
- `/schedule` — reads the user's schedules; needs a course-add UI and a "create schedule" mutation
- `/saved` — reads saved agreements; needs a star-toggle mutation on the detail page
- Autocomplete search on the landing page — still says "coming soon"
- Schedule switcher in the header — nav is hardcoded, doesn't cycle schedules yet

**Not started:**
- Requirement details (which CC courses satisfy each unsatisfied requirement) — the shape is in the RPC's `receiving_courses` JSON; need to also query candidate sending courses
- Star / save-as-target from the detail page
- Filters on the majors ranking (school multiselect, category)

## Design tokens

`src/app/globals.css` defines CSS variables matching the design canvas in
`../design/`. Light mode by default; dark mode via `prefers-color-scheme`.
Utility classes (`bg-surface`, `text-muted`, `border-app`, `text-accent`, …)
wrap the vars so components can style consistently without repeating
`var(--x)` everywhere.

If you want a manual dark-mode toggle instead of relying on the OS setting,
change the media query in globals.css to a `[data-theme="dark"]` selector
and toggle the attribute on `<html>` from a client component.
