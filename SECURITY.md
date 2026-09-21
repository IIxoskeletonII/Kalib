# Security

Kalib is a personal health-data app whose source is public and whose deployment serves two
people. This file is the threat model the code is written against and how to report a hole.

## What is public, and why that is fine

- **The static app.** Anyone can load it. It is a client for their *own* IndexedDB; without an
  account there is nothing on any server.
- **The Supabase project URL and publishable ("anon") key.** They ship in every Supabase app's
  bundle by design. Data access is decided by **row-level security**: every table has one policy,
  `user_id = auth.uid()` for select, insert, update and delete (`supabase/migrations/*`). A valid
  session sees exactly its own rows. **Sign-ups are switched off** in the Supabase dashboard once
  the household's accounts exist, so the key cannot be used to register.
- **The Open Food Facts proxy** (`/api/off/*`). Read-only, GET-only, results cached at the edge,
  query length capped, and rate-limited per IP (60/min). Abusing it costs the abuser more than
  the project.
- **The VAPID public key.** Public by definition.

## What is protected, and how

| Asset                              | Where it lives                                    | Guard                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouter key (costs money)       | Worker secret only                                | `/api/estimate` requires a Supabase session verified server-side, per-user rate limit (6/min), daily caps per user (30) and global (100)      |
| VAPID private key                  | Worker secret only                                | Never leaves the Worker; push messages are encrypted per RFC 8291 and signed per RFC 8292                                                   |
| Push subscriptions (KV)            | Worker KV                                         | Writes require a session; a subscription belongs to the user who created it; ≤ 5 devices per user; endpoints must be a browser push service |
| Supabase `service_role` key        | Nowhere in this project                           | Never needed: erasure is a `security definer` function callable only by the row's own user (`0005_erasure.sql`)                             |
| Health data                        | Device IndexedDB; Supabase rows under RLS         | Export any time (CSV/JSON); one button deletes the account and cascades every row                                                           |
| Personal email of the maintainer   | Not in the repository                             | `VAPID_SUBJECT` is the site URL                                                                                                             |

The Worker's session check (`worker/guard.ts`) asks Supabase's own auth service who the bearer
token belongs to, so it works whether the project signs JWTs with a shared secret or with
asymmetric keys, and it fails closed: any error is "not signed in".

## Browser hardening

`public/_headers` sets a Content-Security-Policy (`default-src 'self'`; scripts from the origin
only; connections to the origin and `*.supabase.co` only; no framing), `X-Content-Type-Options`,
`Referrer-Policy`, a restrictive `Permissions-Policy` (camera only, for barcode and meal photos)
and HSTS. The app has no inline scripts, no `eval`, no `dangerouslySetInnerHTML`, and no
third-party script or analytics of any kind.

Input from outside the device — recipe share codes, Open Food Facts records, model output from
`/api/estimate` — goes through explicit validators (`core/recipeShare.ts`, `worker/off.ts`,
`core/estimate.ts`) that copy known fields into typed, range-checked objects rather than trusting
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
