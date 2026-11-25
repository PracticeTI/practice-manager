# Authentication roadmap

Last updated: 2026-11-25

How admin accounts identify a person today, and the two milestones that move them onto a
verified-email identity with federated sign-in. The executable work lives on GitHub:

- [Native auth enhancements](https://github.com/PracticeTI/practice-manager/milestone/1) — target 2026-12-23
- [Federated auth](https://github.com/PracticeTI/practice-manager/milestone/2) — target 2027-01-23

The admin app was ported from the retired `one` repository, so this replaces the roadmap that
was drafted there; `/admin` and its API routes now live in `apps/core`.

## Where things stand

| Piece | Where |
|-------|-------|
| Admin accounts | `admin_users` in [`apps/core/src/lib/adminUsers.js`](../../apps/core/src/lib/adminUsers.js): `id, username UNIQUE, password_hash, role, domain, email (nullable, not unique), timezone` |
| Primary superadmin | `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables, matched in [`apps/core/src/lib/auth.js`](../../apps/core/src/lib/auth.js) |
| Session | HS256 JWT `{ username, role, domain }`, 24h, held in `localStorage.adminToken` |
| Dev bypass | `localhost-dev-admin-bypass-token` and `vercel-preview-admin-bypass-token` in [`apps/core/src/lib/clientAdminAuth.js`](../../apps/core/src/lib/clientAdminAuth.js) |
| Row-level security | `app.current_username` / `app.current_domain`, bound in [`apps/core/src/lib/postgresRlsContext.js`](../../apps/core/src/lib/postgresRlsContext.js) and enforced by the `user_settings` policy in [`apps/core/src/lib/rlsPolicies.js`](../../apps/core/src/lib/rlsPolicies.js) |
| Per-admin state | `user_settings`, keyed `(domain, username, key)` — dashboard layout, notification preferences, notification read position |
| Identity model | [`apps/core/src/lib/identitySchema.js`](../../apps/core/src/lib/identitySchema.js) — the five tables below, created by `db:init` and `db:prepare`; nothing reads them yet |
| Identity package | [`packages/identity`](../../packages/identity) — placeholder, intended home for the model below |
| Migrations | [`packages/db/migrations`](../../packages/db/migrations) — placeholder, intended home for the schema change. Until then the interim `identitySchema.js` is the migration of record |

Today `username` is the login key and `email` is a contact address used for notifications only.
An email change is therefore *not* an identity change, and nothing is in flight.

## Why email change becomes a schema problem

The moment an email address is also the login key, editing it is an identity operation. Doing
that with a single `UPDATE admin_users SET email = ...` gives three failure modes:

- **Lockout.** The address is wrong, or the typo lands on a mailbox the person cannot read.
- **Silent takeover.** A stolen session moves the address and then uses password reset to keep
  the account.
- **Recycled mailboxes.** A former employee's address is reassigned and can claim the account
  if the old row was simply overwritten.

The industry answer is the same everywhere: the email address is an *attribute with a
verification state*, and the account has a separate stable identifier. An address change
creates a pending claim; nothing about authentication changes until the claim is verified, and
the previous verified address keeps working (and is notified) throughout.

## Identity model

One schema change covers email change, password reset, invites, magic links and federated
sign-in:

```sql
users            (id uuid pk, display_name, status, created_at, updated_at)
user_emails      (id uuid pk, user_id fk, address, is_primary, verified_at,
                  verification_token_hash, verification_expires_at, removed_at, created_at)
user_credentials (user_id pk fk, password_hash, updated_at)
user_tokens      (id uuid pk, user_id fk, purpose, token_hash, expires_at, consumed_at, meta)
auth_identities  (id uuid pk, user_id fk, provider, provider_account_id,
                  UNIQUE (provider, provider_account_id))
```

Rules that the milestones must keep:

- `users.id` is the identity. Email addresses, usernames and provider subjects are all
  attributes of it.
- A `user_emails` row with `verified_at IS NULL` is a pending claim. It cannot log in, receive
  notifications or receive a password reset.
- Uniqueness is partial — `UNIQUE (lower(address)) WHERE verified_at IS NOT NULL` — so a
  pending claim cannot collide with a live address, and two accounts cannot verify the same
  address.
- Retired addresses keep `removed_at` rather than being deleted, so a reassigned mailbox cannot
  later claim the account.
- Federated identities link on the provider's stable subject (`sub`, Entra `oid`), never on
  email. Provider email addresses change too.
- Auto-linking by email is allowed only when the provider asserts the address is verified *and*
  the account already has that address verified.

## Milestone 1 — Native auth enhancements

Goal: email becomes the thing a person types to log in, and changing it is a verified flow
rather than a database edit. `username` survives as an internal immutable handle — it is the
RLS anchor and the `user_settings` key, so it cannot be removed in the same step.

| # | Work | Depends on |
|---|------|------------|
| [#2](https://github.com/PracticeTI/practice-manager/issues/2) | Identity model (`users`, `user_emails`, `user_credentials`, `user_tokens`, `auth_identities`) — additive, nothing reads it yet | — |
| [#3](https://github.com/PracticeTI/practice-manager/issues/3) | Backfill `admin_users` into the identity model (dry run, then `--apply`) | #2 |
| [#4](https://github.com/PracticeTI/practice-manager/issues/4) | Email change with verification: pending claim, notify both addresses, flip on verify | #2 |
| [#5](https://github.com/PracticeTI/practice-manager/issues/5) | Log in with email instead of username; username lookup retained as a fallback | #2, #3 |
| [#6](https://github.com/PracticeTI/practice-manager/issues/6) | Password reset by email, built on `user_tokens` | #4 |
| [#7](https://github.com/PracticeTI/practice-manager/issues/7) | `sub` claim in admin tokens with a `username` compatibility window | #2, #3 |
| [#8](https://github.com/PracticeTI/practice-manager/issues/8) | Re-key `user_settings` on `user_id` and update the RLS predicate | #7 |
| [#9](https://github.com/PracticeTI/practice-manager/issues/9) | Seed the superadmin as a real identity; retire `ADMIN_USERNAME` / `ADMIN_PASSWORD` | #5 |

Sequencing notes:

- #2 and #3 are purely additive and reversible; ship them first and leave them deployed while
  the rest lands.
- #4 is what actually makes an address change safe, and it can land before email is the login
  key.
- #5 and #7 are the transition: both identifier forms work, so no session is force-expired.
- #8 is the last thing that makes `username` removable, and it is the only step that touches
  row-level security. Run `npm run rls:policies` and `npm run rls:verify` in `apps/core` for
  every database, including the replica.
- #9 is intentionally last — it depends on email login existing, otherwise the seeded
  superadmin has no way to sign in.

## Milestone 2 — Federated auth

Goal: Google and Microsoft sign-in against the same identity model, with a per-domain policy so
a practice can require its own identity provider.

| # | Work | Depends on |
|---|------|------------|
| [#10](https://github.com/PracticeTI/practice-manager/issues/10) | OAuth provider registry plus shared start/callback routes (state + PKCE, no provider tokens persisted) | #2, #7 |
| [#11](https://github.com/PracticeTI/practice-manager/issues/11) | Sign in with Google (reference implementation of the linking rules) | #10 |
| [#12](https://github.com/PracticeTI/practice-manager/issues/12) | Sign in with Microsoft Entra ID, with optional tenant pinning | #10 |
| [#13](https://github.com/PracticeTI/practice-manager/issues/13) | Link/unlink rules: never the last credential, re-auth required, audit every change | #11, #12 |
| [#14](https://github.com/PracticeTI/practice-manager/issues/14) | Per-domain sign-in policy (`domain_settings`), enforced server-side | #10 |
| [#15](https://github.com/PracticeTI/practice-manager/issues/15) | Admin UI for linked identities and provider buttons | #11, #12, #13 |

Sequencing notes:

- Adding a provider must be a registry entry plus environment variables, not a new route file.
- The policy in #14 is what makes SSO meaningful for a practice, and it must be enforced in the
  login and OAuth-start routes, not only hidden in the UI.
- Superadmins are never locked out by a domain's policy.

## Decisions recorded

- **Email is not the identity.** `users.id` is. This is the decision the two milestones exist to
  implement.
- **`username` becomes an internal handle**, not a user-facing field. It is generated for new
  accounts and stays the RLS anchor until #8 completes.
- **Two addresses are notified on an email change** — the new one gets the verification link,
  the old one gets a heads-up and a revert path.
- **Unverified addresses cannot receive anything.** Notification resolution
  (`getAdminNotificationEmail`) and password reset read the verified primary address only.
- **Federated identities link on provider subject**, with the verified-address auto-link rule
  above as the only exception.
- **No provider access or refresh tokens are stored.** Only the claims needed to link an
  identity are kept.
- **Dev bypass tokens are out of scope.** `localhost-dev-*` and `vercel-preview-*` remain
  development scaffolding and are not part of the identity model.
- **`simulate-admin` keeps working.** It mints a token for a real account and must carry the
  same `sub` as a normal sign-in (#7).
- **The identity model starts in `apps/core`.** [`identitySchema.js`](../../apps/core/src/lib/identitySchema.js)
  is the interim home and is applied by both `db:init` and `db:prepare`. Moving it to
  `packages/identity` and `packages/db/migrations` is a follow-up, not a prerequisite for #3.

## Open questions

- `admin_users.email` is nullable and not unique today. Duplicate addresses will surface in the
  #3 dry run; each duplicate needs a decision (one verified primary, the other left unverified)
  before the backfill is applied.
- Whether the seeded superadmin in #9 gets an invite token or a password-reset link on first
  deploy.
- Whether Google Workspace `hd` restriction belongs in #11 or in the per-domain policy (#14).
  Current thinking: the policy owns it, so it applies to Entra tenant pinning the same way.
- Whether an admin should be able to hold more than one verified address for notifications, or
  one primary plus retired aliases only.
- When to move the identity model from `apps/core/src/lib/identitySchema.js` into
  `packages/identity` and `packages/db/migrations`. Both are placeholders today; the move should
  happen once those packages have a client and migration runner, so the model does not drift
  between two homes.

## Keeping this document current

Update this file when a milestone changes shape — a split, a dropped step, or a new decision.
Issue bodies are the working detail; this document records the shape and the reasons.
