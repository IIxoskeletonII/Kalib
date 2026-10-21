# Security

Kalib is a personal health-data app whose source is public and whose deployment is open for
anyone to try. This file is the threat model the code is written against and how to report a hole.

## What is public, and why that is fine

- **The static app.** Anyone can load it. It is a client for their *own* IndexedDB; without an
  account there is nothing on any server.
- **The Supabase project URL and publishable ("anon") key.** They ship in every Supabase app's
  bundle by design. Data access is decided by **row-level security**: every synced table has one
  policy, `user_id = auth.uid()` for select, insert, update and delete (`supabase/migrations/*`).
  A valid session sees exactly its own rows. The one exception — a circle's weekly scores, shown
  to people who share a circle — is described under *The circle* below, and goes through
  functions, never through a table a client can read. **Sign-ups are open on purpose**: a stranger's account holds
  a stranger's data and nothing else, and one button deletes it. (A private deployment can turn
  sign-ups off in the Supabase dashboard.)
- **The Open Food Facts proxy** (`/api/off/*`). Read-only, GET-only, results cached at the edge,
  query length capped, and rate-limited per IP (60/min). Abusing it costs the abuser more than
  the project.
- **The VAPID public key.** Public by definition.

## What is protected, and how

| Asset                              | Where it lives                                    | Guard                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouter key (costs money)       | Worker secret only                                | `/api/estimate`, `/api/suggest`, `/api/label`, `/api/menu` and `/api/recipe` require a Supabase session verified server-side, per-user rate limit (6/min), shared daily caps per user (30) and global (100), optional email allow-list; the balance behind it is small and prepaid, so the worst case is a paused feature, never a bill. `/api/coach/injury` has its own smaller pool (5 per user, 20 in total) — see *Injury help* below |
| Recipe bank and weekly trends (KV) | Worker KV                                         | `/api/suggest/keep` requires a session and stores recipe content only (no user id, no personal data), capped at 500 entries; trends are titles fetched server-side from public RSS feeds, never user input |
| VAPID private key                  | Worker secret only                                | Never leaves the Worker; push messages are encrypted per RFC 8291 and signed per RFC 8292                                                   |
| Push subscriptions (KV)            | Worker KV                                         | Writes require a session; a subscription belongs to the user who created it; ≤ 5 devices per user; endpoints must be a browser push service |
| Fetching a user-supplied URL (`/api/recipe`) | Worker, no credentials forwarded | The one place the Worker fetches an address a user chose, so the guard fails closed: https/http only, no IP literals in any spelling (dotted, decimal, hex, IPv6), no `localhost`/`.local`/`.internal`/`.lan`/single-label hosts, no ports but 80 and 443, every redirect hop re-checked by hand rather than followed, ≤ 3 hops, ≤ 1.2 MB, 8 s timeout, HTML only. No cookies, no `Authorization`, nothing from the caller's session travels with it. 27 tests in `worker/recipeUrl.test.ts` cover the refusals, including the cloud metadata address |
| Writing to Open Food Facts (`/api/off/contribute`) | Worker secret only | Opt-in per product in the UI and inert unless `OFF_USER_ID` and `OFF_PASSWORD` are set, so a fork cannot write to the commons under someone else's name. Requires a session, rate-limited per user, and refuses a record whose macros do not account for its calories. Sends the barcode, name, brand and per-100 g figures only |
| Supabase `service_role` key        | Nowhere in this project                           | Never needed: erasure (`0005_erasure.sql`) and the circle (`0009_circle.sql`) are `security definer` functions that act only for the signed-in caller |
| Health data                        | Device IndexedDB; Supabase rows under RLS         | Export any time (CSV/JSON); one button deletes the account and cascades every row                                                           |
| Personal email of the maintainer   | Not in the repository                             | `VAPID_SUBJECT` is the site URL                                                                                                             |

The Worker's session check (`worker/guard.ts`) asks Supabase's own auth service who the bearer
token belongs to, so it works whether the project signs JWTs with a shared secret or with
asymmetric keys, and it fails closed: any error is "not signed in".

### The circle (cross-user, by invitation)

`0009_circle.sql` is the only place one account's data reaches another. The exception is kept
as small as it can be made:

- **Nothing to read directly.** The five circle tables have row-level security on and *no*
  policies, and every privilege is revoked from `anon` and `authenticated`, so a direct query
  returns "permission denied" even with Supabase's default grants. The client surface is ten
  `security definer` functions with `search_path` pinned to empty, executable by signed-in users
  only; the helpers they use are executable by nobody.
- **Only integers cross.** Per person per week: sessions planned and done, three scores out of
  100, a count of left-out jumps, a hard-mode flag and rating. `circle_publish` rejects any
  other key and the table range-checks every value, so the endpoint cannot be used to store
  anything else. No account id or email is returned to another member; the board names people
  by a per-circle member id and a display name they chose.
- **Membership is the permission.** You see a person's scores only while you share a circle,
  and only that circle's members. Nothing is published before you join one; leaving your last
  circle, being removed, or deleting the account deletes what you published (a trigger, so it
  holds for the account-deletion cascade too). Ownership passes to the longest-standing member.
- **Invites.** ~50-bit codes from an unambiguous alphabet by rejection sampling, stored only as
  SHA-256, seven-day expiry, one live code per circle, revocable, twenty joins at most. Ten
  failed joins in an hour lock that account out of joining for the hour; a failed join returns
  rather than raises so the attempt is actually recorded. Twelve people per circle, five circles
  per person.
- **Self-reported, and treated as such.** Scores are computed on the phone, so a determined
  member can publish a fiction about themselves. The design limits what that buys: the score is
  relative to your own past and capped at 100, implausible jumps are left out until repeated,
  and a fiction can only flatter its author — it cannot read or alter anyone else's row.

`scripts/circle-sql.test.ts` runs the migration against a private PostgreSQL and attacks it as
the above describes: as anon, as a signed-in stranger, straight at the tables, with guessed,
expired, revoked and used-up codes, with smuggled fields and out-of-range values.
### Injury help: health data to a model

`/api/coach/injury` (SPEC §20.16) is the one endpoint that receives special-category health
data — a description of an injury — and passes it to a third party, the OpenRouter model. It
is held to a stricter rule than the meal endpoints:

- **Nothing is sent without explicit consent.** The client asks first, says what goes where,
  stores a versioned agreement (`injury-v1`) that Settings shows and withdraws, and sends it as
  an `x-kalib-consent` header. The Worker refuses a request without the current version, and
  checks it, the session and the allow-list **before reading the body**.
- **The worst descriptions never leave the phone.** A deterministic red-flag screen
  (`src/core/redFlags.ts`; NHS and NICE criteria, English and Italian) runs on the device
  before anything is sent, and again in the Worker before the model is called; a hit is
  answered with "see a doctor", spends no quota and calls no model. The model's answer is
  screened again on the device, and withheld if it reads like a diagnosis.
- **Minimal, and kept nowhere.** What is sent is the description (≤ 400 characters) and
  exercise names, muscles and equipment — no ids, history or body data. The Worker logs
  nothing about the request, stores nothing but two daily counters (date and user id), and
  reports an upstream failure by status code only, because an error page may quote what it was
  sent. Tests assert all three (`worker/injury.test.ts`).
- **Its own spending cap.** 5 per user and 20 in total a day (`INJURY_DAILY_USER`,
  `INJURY_DAILY_TOTAL`), counted apart from estimates, `max_tokens` 1000.
- **Untrusted output.** The answer is copied field by field (`src/core/injury.ts`); a swap is
  applied only if it names an exercise that exists in the person's own library.

What OpenRouter and the model provider do with a request is governed by their terms, not this
code; the request carries nothing that identifies the person beyond what they choose to type.

### Microphone

Dictation uses the browser's own `SpeechRecognition`. No audio reaches this app or its Worker,
the control is absent where the browser has no recogniser, and a live session is cancelled when
the screen unmounts (`src/platform/speech.ts`).

## Browser hardening

`public/_headers` sets a Content-Security-Policy (`default-src 'self'`; scripts from the origin
only; connections to the origin and `*.supabase.co` only; no framing), `X-Content-Type-Options`,
`Referrer-Policy`, a restrictive `Permissions-Policy` (camera only, for barcode and meal photos)
and HSTS. The app has no inline scripts, no `eval`, no `dangerouslySetInnerHTML`, and no
third-party script or analytics of any kind.

Input from outside the device — recipe share codes, Open Food Facts records, model output from
`/api/estimate` and `/api/coach/injury` — goes through explicit validators (`core/recipeShare.ts`,
`worker/off.ts`, `core/estimate.ts`, `core/injury.ts`) that copy known fields into typed, range-checked objects rather than trusting
the shape. A JSON backup is the user's own file restored into their own database: its structure
is checked, its rows are not second-guessed.

## What is *not* defended, on purpose

- **Denial of service against the free tier.** Someone hammering `/api/off/*` from many IPs can
  exhaust the Worker's daily request allowance and take the API offline for the day. The static
  app is served outside that allowance and keeps working; logging is local. This is accepted.
- **A compromised phone.** The device is the trust boundary; there is no second factor.
- **Supabase itself.** If the platform is breached, RLS is only as good as the platform.

## Reporting

Open a private security advisory on the repository (Security → Report a vulnerability) rather
than a public issue. There is no bounty; there is gratitude and a fast fix.
