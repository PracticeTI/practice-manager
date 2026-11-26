-- Carry the runtime role's grants forward to objects that later migrations create.
--
-- A Supabase branch starts secure by default: tables and sequences are unreachable until a
-- migration grants them, and the base project's ACLs are not copied. The baseline therefore
-- grants `practice_manager_app` explicitly, but only on the objects that exist at that point.
-- Without the defaults below, a table added by a later migration would be invisible to the app
-- on a branch while the same table works on an install where the owner applied `db:prepare`.
--
-- These statements apply to objects created by the role that runs this migration, which is the
-- same role that applies every later migration on each environment (the branch's `postgres`, or
-- the owner in Docker, LAN and desktop installs).
--
-- `PUBLIC` executes new functions by default, so a new function needs an explicit revoke rather
-- than an absent grant. The revocation is global rather than schema-scoped: PostgreSQL 14
-- silently ignores a schema-scoped `REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` when no other
-- schema-scoped function default exists.
--
-- The API roles (`anon`, `authenticated`, `service_role`) get nothing: the app talks to
-- PostgreSQL through `pg` and serves no Data API. A deployment that wants the defence-in-depth
-- revoke from `apps/core/docs/postgres-rls-rollout.md` applies it with the owner credential,
-- because those roles do not exist on every install.

alter default privileges in schema public
  grant select, insert, update, delete on tables to practice_manager_app;

alter default privileges in schema public
  grant select, usage on sequences to practice_manager_app;

alter default privileges
  grant execute on functions to practice_manager_app;

alter default privileges
  revoke execute on functions from public;
