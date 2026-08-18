@AGENTS.md

# NextStop — Web

Next.js 16 (App Router) + Supabase for the NextStop transfer-planner UI. Parent project docs: [../CLAUDE.md](../CLAUDE.md).

**Stack:** Next.js 16 with Turbopack + React 19, TypeScript, Tailwind 4, `@supabase/ssr` (SSR-safe auth), Google OAuth via Supabase Auth. Server components by default; client components only where interaction requires them.

## Directory layout

```
web/
├── .env.local                Real Supabase URL + anon key (gitignored)
├── .env.local.example        Template
├── middleware.ts             Refreshes auth cookies on every request
├── package.json              Scripts: dev, build, start, lint, types
├── AGENTS.md                 Next.js self-generated agent warning (auto-refreshes on `next dev`)
└── src/
    ├── app/
    │   ├── layout.tsx                Root layout + metadata
    │   ├── globals.css               Design tokens (CSS vars + Tailwind @utility)
    │   ├── page.tsx                  Landing (public) — reads live agreement count
    │   ├── auth/
    │   │   ├── callback/route.ts     OAuth code → session
    │   │   └── error/page.tsx        Sign-in failure fallback
    │   ├── schedule/page.tsx         Auth-required stub
    │   ├── majors/
    │   │   ├── page.tsx              Ranked list — calls rank_agreements_for_courses RPC
    │   │   └── [id]/page.tsx         Requirement checklist — calls check_agreement_for_courses RPC
    │   └── saved/page.tsx            Auth-required stub
    ├── components/
    │   ├── Header.tsx                Server component — reads current user
    │   ├── GoogleSignInButton.tsx    Client
    │   └── SignOutButton.tsx         Client
    └── lib/
        ├── supabase/
        │   ├── client.ts             Browser client (`createBrowserClient`)
        │   ├── server.ts             Server-component client (async, wraps Next cookies())
        │   └── middleware.ts         Session-refresh helper called from middleware.ts
        ├── database.types.ts         Hand-crafted DB types matching sql/001–005 — see § Types
        └── mvp.ts                    Roster constants — keep in sync with ../mvp_config.py
```

## Setup (one-time)

Full steps in [README.md](README.md). The essentials:

1. `cp .env.local.example .env.local` — fill in `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Supabase Dashboard → Project Settings → API.
2. Configure Google OAuth: Google Cloud Console → OAuth 2.0 Client ID → redirect `https://<ref>.supabase.co/auth/v1/callback`; paste client ID + secret into Supabase Dashboard → Authentication → Providers → Google; add `http://localhost:3000/auth/callback` to Redirect URLs.
3. `npm install && npm run dev` → http://localhost:3000.

## Wiring state (2026-08-18)

**Working end-to-end** (no code changes needed):
- Google OAuth sign-in / sign-out
- Landing shows live `count(*) FROM agreements`
- `/majors` — server-renders the RPC ranking (empty course array = all majors at 0%)
- `/majors/[id]` — server-renders the requirement checklist, splits into What you have / What you need / Verify with counselor

**Scaffolded (renders but not interactive):**
- `/schedule` — reads schedules for the user, empty-state UI. Needs a course-search + `insert into schedule_courses` mutation.
- `/saved` — reads `saved_agreements`. Needs a star-toggle mutation on the detail page.
- Landing course-search input — placeholder text "coming soon".
- Header schedule switcher — mocked in `design/`, not yet in `Header.tsx`.
- `/majors/[id]` unsatisfied requirements don't yet list *which* CC courses would satisfy them (data is in the RPC's `receiving_courses` JSON — needs an extra query for sending-side candidates).

**Not started:**
- Autocomplete against `courses` filtered by institution.
- Filter chips on `/majors` (school multiselect, category).
- Star-to-save from `/majors/[id]`.
- Any mutation flow at all — currently the app is read-only.

## Types

`src/lib/database.types.ts` is **hand-crafted** to match the schema in `../sql/001..005*.sql`. Shape matches `supabase gen types typescript --schema public` output — every Table has `Row/Insert/Update/Relationships`; `Views/Enums/CompositeTypes` are stubbed as `{[_ in never]: never}`; `Functions` is a flat map of Args → Returns.

**Regenerate with the Supabase CLI:**

```bash
brew install supabase/tap/supabase        # one-time
supabase login && supabase link --project-ref $SUPABASE_PROJECT_REF
npm run types                              # writes to src/lib/database.types.ts
```

The generator makes RPC arg types less friendly than the hand-written ones (loses argument names on optional params). If you regenerate and lose the ergonomics, copy the `Functions` block back from git and keep the rest.

**Why the current shape matters:** `@supabase/ssr` v0.12+ silently infers every row as `never` when any field of the Database type is missing (`Relationships`, `Views`, etc.). If a page suddenly shows `Property 'x' does not exist on type 'never'`, the types file is the first suspect.

## Auth model

- **Supabase Auth** with Google OAuth as the provider (no email/password, no email verification).
- On first sign-in, the `handle_new_user()` trigger in `sql/004_student_side.sql` populates `profiles` with `display_name` + `avatar_url` from Google's `raw_user_meta_data`.
- Sessions are cookie-based; `middleware.ts` refreshes tokens on every request via `updateSession()`.
- Server components read the user via `const { data: { user } } = await supabase.auth.getUser()` — always call `getUser()` (which validates against Supabase servers), never `getSession()` (which trusts the cookie).
- **Public-browse** means anon users can hit `/`, `/majors`, `/majors/[id]` — everything reads via RLS with public-read policies on ASSIST tables. Signed-in-only routes call `redirect('/')` if no user.

## Design tokens strategy

`globals.css` defines CSS custom properties in `:root` (light) and `@media (prefers-color-scheme: dark)`. Utility classes (`bg-surface`, `text-muted`, `border-app`, `text-accent`, …) are declared via Tailwind 4's `@utility` directive so components can style consistently without repeating `var(--x)`.

**Why this pattern and not Tailwind's `@theme`?** `@theme` wants concrete values Tailwind can inline. Since we want tokens to switch under `prefers-color-scheme`, the CSS-var indirection is required, and `@utility` wraps the vars cleanly. If you want a manual dark toggle later, change the media query to `[data-theme="dark"]` and toggle the attribute on `<html>` from a client component.

**Tokens are duplicated in `design/*.dc.html`.** Keep them in sync — the mockup is the design spec; the web app is its implementation.

## Conventions

- **Inline styles for design tokens**, Tailwind classes for layout (`flex`, `gap-4`, `p-6`). This matches the mockup and keeps token references local to the element being styled.
- **Server components by default.** Client components (`'use client'`) only for interactivity (sign-in/out buttons, forms). Data fetching happens in server components — no `useEffect` fetches, no client-side Supabase for reads.
- **RPCs over table joins** where the requirement engine is involved. `check_agreement_for_courses` is one round trip; the equivalent client-side join across 5 tables would be several.
- **Route params + searchParams are Promises** in Next 16 — always `await` them (`const { id } = await params`).
- **Never call `getSession()` on the server** — it doesn't validate against Supabase and can be spoofed via a stale cookie. Use `getUser()`.

## Next building moves (pick one)

1. **Course autocomplete + schedule mutation** — client-side search against `courses` filtered by `institution_id`, then `insert into schedule_courses`. Highest-leverage: unlocks the whole "put in your schedule → see matching majors" flow. Landing input already exists as a placeholder.
2. **Star-to-save on major detail** — one `insert into saved_agreements`; toggle icon. Cheap. Lets the Saved page graduate from stub.
3. **Enrich `/majors/[id]` unsatisfied section** — parallel-query for each unsatisfied requirement: "which CC courses satisfy this?" Data flow: for each entry, fetch `sending_group_courses → courses` from other CCs. Consider a helper RPC.
4. **Header schedule switcher** — currently there's just one schedule per user assumed. Add a dropdown reading `schedules` for the current user, primary-first.
5. **Replace hand-written types with generated ones** — install Supabase CLI, run `npm run types`, hand-merge the Functions block back.

## Gotchas

- **Restart `npm run dev` after `.env.local` changes.** Next only reads env at boot.
- **`.env.local.example` is gitignored** by the `.env*` pattern in the parent `.gitignore` — even if you paste real credentials in the example file, they won't leak. But keep the example file with placeholders for future contributors.
- **Types file shape matters** — see § Types.
- **Turbopack is on by default in Next 16.** The `--turbopack` flag we passed to `create-next-app` is now the standard.
- **`middleware.ts` lives at the web root**, not in `src/`. Moving it under `src/` breaks Next's discovery.
- **Server-side Supabase calls need `await`** on both `cookies()` (Next 15+) and `createClient()` (our async wrapper).
