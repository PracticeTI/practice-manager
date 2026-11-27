-- Applied after migrations by `supabase db reset` and on every preview branch.
--
-- Nothing is seeded yet. This file is published and replayed on branches, so it must never
-- name a private domain (npm run private:guard) or carry a credential (gitleaks, see
-- .gitleaks.toml).

-- Branching probe: this comment exists so a pull request touches packages/db/supabase and makes
-- Supabase create a preview branch. Remove it when the probe is done.
