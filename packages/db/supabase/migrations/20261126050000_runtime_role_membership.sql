-- Let the role that applies migrations assume the runtime role.
--
-- On a Supabase preview branch the migrations run as `postgres`, and the integration gives the
-- preview deployment that same login through `POSTGRES_URL`. `postgres` there is neither a
-- superuser nor a member of `practice_manager_app`, so a domain-scoped request's `SET LOCAL ROLE
-- practice_manager_app` fails with "permission denied to set role" and every RLS-bound route
-- returns 500. The app assumes the role whenever `POSTGRES_RLS_RUNTIME_ROLE` is set, which it is
-- on the preview project.
--
-- The grant goes to `current_user`, the role running this migration: `postgres` on Supabase, the
-- database owner in Docker, LAN and desktop installs. It changes nothing for the owner, because
-- ownership outranks every grant, and it is what keeps a branch honest — routes run under the
-- same policies production uses instead of under the owner login.
--
-- On an install whose `practice_manager_app` was created by a different role, the migrating role
-- may lack ADMIN OPTION; the grant is then skipped instead of failing the migration.
-- `apps/core/docs/postgres-rls-rollout.md` covers how to arrange the login out of band.

do $$
begin
  if current_user <> 'practice_manager_app'
     and exists (select 1 from pg_roles where rolname = 'practice_manager_app') then
    begin
      execute format('grant practice_manager_app to %I', current_user);
    exception
      when insufficient_privilege then
        raise notice 'cannot grant practice_manager_app to %; RLS-bound requests need POSTGRES_RLS_RUNTIME_ROLE unset or the membership arranged out of band', current_user;
    end;
  end if;
end
$$;
