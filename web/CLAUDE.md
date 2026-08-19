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
    │   │   ├── page.tsx              Two-step: umbrella-major picker → schools ranked (rank_agreements_for_courses)
    │   │   └── [id]/page.tsx         Requirement checklist — calls check_agreement_for_courses RPC
    │   └── saved/page.tsx            Auth-required stub
    ├── components/
    │   ├── Header.tsx                Server component — reads current user
    │   ├── GoogleSignInButton.tsx    Client
    │   ├── SignOutButton.tsx         Client
    │   ├── ui/QueryError.tsx         Shared error box for failed Supabase queries (token-based, dark-safe)
    │   └── schedule/                 Editor, search, and the localStorage↔DB sync components
    └── lib/
        ├── supabase/
        │   ├── client.ts             Browser client (`createBrowserClient`)
        │   ├── server.ts             Server-component client (async, wraps Next cookies())
        │   └── middleware.ts         Session-refresh helper called from middleware.ts
        ├── courses/params.ts         `?courses=` URL codec — parse/serialize course-id lists (one seam)
        ├── requirements/classify.ts  classifyEntries(rows) → satisfied/unsatisfied/notes + completion % (the rule, one owner)
        ├── schedule/                 store.ts (localStorage) + sync.ts (DB) + format.ts (display shaping)
        ├── database.types.ts         Hand-crafted DB types matching sql/001–005 — see § Types
        └── mvp.ts                    Roster constants — keep in sync with ../mvp_config.py
```

## Setup (one-time)

Full steps in [README.md](README.md). The essentials:

1. `cp .env.local.example .env.local` — fill in `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Supabase Dashboard → Project Settings → API.
2. Configure Google OAuth: Google Cloud Console → OAuth 2.0 Client ID → redirect `https://<ref>.supabase.co/auth/v1/callback`; paste client ID + secret into Supabase Dashboard → Authentication → Providers → Google; add `http://localhost:3000/auth/callback` to Redirect URLs.
3. `npm install && npm run dev` → http://localhost:3000.

## Public-browse — no sign-in required

**The whole app works signed out; signing in only *saves* data.** The one
account-bound page is `/saved` (saving is its entire point) — it shows a
sign-in prompt instead of redirecting.

An anonymous schedule is just a list of course IDs in `localStorage` (the
requirement engine only needs IDs). Signing in migrates it to the DB. See
§ Anonymous schedule store below.

## Deployment

Live on **Vercel** (deployed 2026-08-19). Key settings:
- **Root Directory = `web/`** (the Next app is not at the repo root — this is the one setting that breaks the build if missed).
- Env vars set in the Vercel dashboard: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both publishable/anon — they ship to the browser anyway; `.env.local` stays gitignored).
- **Auto-deploys on every push to `main`**; the production URL is a stable alias, so updates never change the link. Other branches get preview URLs.
- **Sign-in is not yet functional in production** — needs the Google OAuth config (see parent [../CLAUDE.md](../CLAUDE.md) next steps) plus the prod redirect URL `https://<vercel-domain>/auth/callback` added to Supabase → Authentication → URL Configuration. Everything else (public-browse) works live.

## Wiring state (2026-08-19)

**Working end-to-end** (no code changes needed):
- Google OAuth sign-in / sign-out
- Landing shows live `count(*) FROM agreements`
- `/majors` — **two-step flow.** Step 1: a picker of 3 fixed umbrella majors (Computer Science / Electrical Engineering / Computer Engineering). Step 2 (`?major=<category-key>`): every receiving school with a program under that umbrella, ranked against the schedule via `rank_agreements_for_courses`. The umbrella buckets are hardcoded keyword predicates (`MAJOR_CATEGORIES`) matching `agreements.major_name` — each independent, so a program can appear under two umbrellas. Rows dedupe to one per `(school, program)`, collapsing per-sending-CC 0% repeats while keeping every distinct major visible. `CoursesUrlSync` reflects the local schedule into `?courses=` (coexists with `?major=`) so anon rankings update.
- `/majors/[id]` — server-renders the requirement checklist, splits into What you have / What you need / Verify with counselor
- `/schedule` — **interactive editor, works signed out.** Course autocomplete against `courses`, add/remove, per-course status. Signed-in users autosave to the DB (see § Anonymous schedule store).

**Scaffolded (renders but not interactive):**
- `/saved` — reads `saved_agreements` for signed-in users; anon sees a sign-in prompt. Needs a star-toggle mutation on the detail page to populate it.
- Header schedule switcher — mocked in `design/`, not yet in `Header.tsx` (the store assumes one schedule, "My schedule").
- `/majors/[id]` unsatisfied requirements don't yet list *which* CC courses would satisfy them (data is in the RPC's `receiving_courses` JSON — needs an extra query for sending-side candidates).

**Not started:**
- School multiselect filter on `/majors` (the umbrella-**major** picker is done; filtering *within* a category by receiving school is not). To grow past the 3 MVP umbrellas, extend `MAJOR_CATEGORIES` in `majors/page.tsx`.
- Star-to-save from `/majors/[id]` (the only remaining mutation; `saved_agreements` insert/delete).
- Multiple named schedules (store + DB both currently assume a single primary "My schedule").

## Anonymous schedule store

The schedule editor's live source of truth is **`localStorage`, signed in or
not** — never the DB directly. This keeps one editing path.

- **`lib/schedule/store.ts`** — `localStorage`-backed store via `useSyncExternalStore` (key `nextstop.schedule.v1`). Cross-tab sync via the `storage` event. Hook `useScheduleCourses()`; imperative `getScheduleCourses()` / `subscribeToSchedule()` for non-React code. A course carries display fields (`label`, `sub`) so the editor renders with no round-trip; only `id` feeds the engine.
- **`lib/schedule/sync.ts`** — the *only* place the app writes `schedules` / `schedule_courses`. `pushLocalToDb` mirrors local → a single primary "My schedule" (delete-then-insert the course set); `pullDbToLocal` hydrates local from the saved schedule. Uses two-step queries (no FK embeds — see § Types).
- **`components/schedule/ScheduleSync.tsx`** — mounted once in `layout.tsx`, renders null. Owns all persistence: on sign-in it reconciles once (local non-empty → push, so the just-built list wins; local empty → pull), then debounce-autosaves local edits while signed in. This component *is* the "sign in = save" story.
- **`components/schedule/CoursesUrlSync.tsx`** — on `/majors` + `/majors/[id]`, pushes the local course IDs into `?courses=` so the server-rendered ranking matches the editor.

**Reconcile rule:** local wins on sign-in when both exist (the user was just editing). Cross-device restore works because an empty local pulls the saved copy. Multi-device concurrent edits are last-write-wins — acceptable for MVP.

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
- **Server components by default.** Client components (`'use client'`) only for interactivity (sign-in/out buttons, forms). Page data fetching happens in server components — no `useEffect` fetches for the initial render. **Exception:** the schedule editor is fully client-side (it reads/writes `localStorage` and needs to work signed out), so `CourseSearch` does live client-side `courses` reads and the store persistence runs in effects. Keep that pattern scoped to the schedule editor.
- **RPCs over table joins** where the requirement engine is involved. `check_agreement_for_courses` is one round trip; the equivalent client-side join across 5 tables would be several.
- **Route params + searchParams are Promises** in Next 16 — always `await` them (`const { id } = await params`).
- **Never call `getSession()` on the server** — it doesn't validate against Supabase and can be spoofed via a stale cookie. Use `getUser()`.

## Next building moves (pick one)

1. **Star-to-save on major detail** — one `insert into saved_agreements`; toggle icon. Cheap. Lets the Saved page graduate from stub. Only remaining mutation flow. (For anon users, star could nudge sign-in — mirror the schedule editor's save card.)
2. **Enrich `/majors/[id]` unsatisfied section** — parallel-query for each unsatisfied requirement: "which CC courses satisfy this?" Data flow: for each entry, fetch `sending_group_courses → courses` from other CCs. Consider a helper RPC.
3. **Header schedule switcher + multiple schedules** — the store and DB both currently assume one primary "My schedule". Generalize the store to keyed schedules, add a dropdown reading `schedules`, primary-first.
4. **Replace hand-written types with generated ones** — install Supabase CLI, run `npm run types`, hand-merge the Functions block back. (Would also make FK embeds type cleanly, letting `sync.ts` / `/saved` drop their two-step queries.)

## Gotchas

- **Restart `npm run dev` after `.env.local` changes.** Next only reads env at boot.
- **`.env.local.example` is gitignored** by the `.env*` pattern in the parent `.gitignore` — even if you paste real credentials in the example file, they won't leak. But keep the example file with placeholders for future contributors.
- **Types file shape matters** — see § Types.
- **Turbopack is on by default in Next 16.** The `--turbopack` flag we passed to `create-next-app` is now the standard.
- **`middleware.ts` lives at the web root**, not in `src/`. Moving it under `src/` breaks Next's discovery.
- **Server-side Supabase calls need `await`** on both `cookies()` (Next 15+) and `createClient()` (our async wrapper).
