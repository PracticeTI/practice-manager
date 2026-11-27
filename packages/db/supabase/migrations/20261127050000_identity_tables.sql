-- Create the identity, content-relationship and task tables on a database that predates them.
--
-- The baseline creates all seven of these. The hosted project has never run it — it was built by
-- `db:init` before the identity model landed — so `migration repair --status applied
-- 20261126033000` would record objects that are not there, and the code that needs them only
-- creates one when a route first touches it. Before this file the drift ran both ways: the
-- hosted project was behind the migrations while the migrations were behind the routes.
--
-- Repeating the baseline's own definitions keeps both directions honest. A fresh database, a
-- Supabase branch and a Docker install get these from the baseline, so this file is a no-op
-- there; a database that already has the schema but not these tables gets them from here. Every
-- statement is idempotent, which is what lets `db push --include-all` run it on the hosted
-- project alongside the migrations it has already applied.
--
-- The six identity tables are created with RLS enabled and no policy, exactly as the baseline
-- defines them: closed to the runtime role, not open. `task_entries` is the exception, because it
-- is tenant-scoped and carries the domain policy. The identity milestone adds the policies these
-- tables need; until then a request that reaches them reads nothing rather than everything.

CREATE TABLE IF NOT EXISTS public.auth_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(32) NOT NULL,
    provider_account_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.content_relationships (
    id integer NOT NULL,
    source_id integer NOT NULL,
    target_id integer NOT NULL,
    relationship_type character varying(50) NOT NULL,
    role character varying(255),
    "position" integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.content_relationships_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.content_relationships_id_seq OWNED BY public.content_relationships.id;

CREATE TABLE IF NOT EXISTS public.task_entries (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    item_key character varying(200) NOT NULL,
    fingerprint text DEFAULT ''::text NOT NULL,
    group_key character varying(160) DEFAULT ''::character varying NOT NULL,
    group_name character varying(255) DEFAULT ''::character varying NOT NULL,
    kind character varying(32) DEFAULT ''::character varying NOT NULL,
    patient_id character varying(64),
    patient_name character varying(255) DEFAULT ''::character varying NOT NULL,
    worker_label character varying(160) DEFAULT ''::character varying NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    action_label character varying(120) DEFAULT ''::character varying NOT NULL,
    href text DEFAULT ''::text NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    oldest_created_at timestamp with time zone,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    dismissed_at timestamp with time zone,
    dismissed_by character varying(128)
);

CREATE SEQUENCE IF NOT EXISTS public.task_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.task_entries_id_seq OWNED BY public.task_entries.id;

CREATE TABLE IF NOT EXISTS public.user_credentials (
    user_id uuid NOT NULL,
    password_hash text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    address text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    verification_token_hash text,
    verification_expires_at timestamp with time zone,
    removed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    purpose character varying(32) NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name character varying(255),
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.content_relationships ALTER COLUMN id SET DEFAULT nextval('public.content_relationships_id_seq'::regclass);

ALTER TABLE ONLY public.task_entries ALTER COLUMN id SET DEFAULT nextval('public.task_entries_id_seq'::regclass);

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'auth_identities_pkey'
        and conrelid = 'public.auth_identities'::regclass) then
        ALTER TABLE ONLY public.auth_identities
    ADD CONSTRAINT auth_identities_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'auth_identities_provider_provider_account_id_key'
        and conrelid = 'public.auth_identities'::regclass) then
        ALTER TABLE ONLY public.auth_identities
    ADD CONSTRAINT auth_identities_provider_provider_account_id_key UNIQUE (provider, provider_account_id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'content_relationships_pkey'
        and conrelid = 'public.content_relationships'::regclass) then
        ALTER TABLE ONLY public.content_relationships
    ADD CONSTRAINT content_relationships_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'content_relationships_source_id_target_id_relationship_type_key'
        and conrelid = 'public.content_relationships'::regclass) then
        ALTER TABLE ONLY public.content_relationships
    ADD CONSTRAINT content_relationships_source_id_target_id_relationship_type_key UNIQUE (source_id, target_id, relationship_type);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'task_entries_pkey'
        and conrelid = 'public.task_entries'::regclass) then
        ALTER TABLE ONLY public.task_entries
    ADD CONSTRAINT task_entries_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'user_credentials_pkey'
        and conrelid = 'public.user_credentials'::regclass) then
        ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_pkey PRIMARY KEY (user_id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'user_emails_pkey'
        and conrelid = 'public.user_emails'::regclass) then
        ALTER TABLE ONLY public.user_emails
    ADD CONSTRAINT user_emails_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'user_tokens_pkey'
        and conrelid = 'public.user_tokens'::regclass) then
        ALTER TABLE ONLY public.user_tokens
    ADD CONSTRAINT user_tokens_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'users_pkey'
        and conrelid = 'public.users'::regclass) then
        ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
    end if;
end $$;

CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON public.auth_identities USING btree (user_id);

CREATE INDEX IF NOT EXISTS content_rel_source_idx ON public.content_relationships USING btree (source_id);

CREATE INDEX IF NOT EXISTS content_rel_target_idx ON public.content_relationships USING btree (target_id);

CREATE INDEX IF NOT EXISTS content_rel_type_idx ON public.content_relationships USING btree (relationship_type);

CREATE UNIQUE INDEX IF NOT EXISTS task_entries_domain_item_idx ON public.task_entries USING btree (domain, item_key);

CREATE INDEX IF NOT EXISTS user_emails_user_idx ON public.user_emails USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS user_emails_verified_address_key ON public.user_emails USING btree (lower(address)) WHERE (verified_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS user_tokens_user_idx ON public.user_tokens USING btree (user_id);

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'auth_identities_user_id_fkey'
        and conrelid = 'public.auth_identities'::regclass) then
        ALTER TABLE ONLY public.auth_identities
    ADD CONSTRAINT auth_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'content_relationships_source_id_fkey'
        and conrelid = 'public.content_relationships'::regclass) then
        ALTER TABLE ONLY public.content_relationships
    ADD CONSTRAINT content_relationships_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.content(id) ON DELETE CASCADE;
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'content_relationships_target_id_fkey'
        and conrelid = 'public.content_relationships'::regclass) then
        ALTER TABLE ONLY public.content_relationships
    ADD CONSTRAINT content_relationships_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.content(id) ON DELETE CASCADE;
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'user_credentials_user_id_fkey'
        and conrelid = 'public.user_credentials'::regclass) then
        ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'user_emails_user_id_fkey'
        and conrelid = 'public.user_emails'::regclass) then
        ALTER TABLE ONLY public.user_emails
    ADD CONSTRAINT user_emails_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'user_tokens_user_id_fkey'
        and conrelid = 'public.user_tokens'::regclass) then
        ALTER TABLE ONLY public.user_tokens
    ADD CONSTRAINT user_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    end if;
end $$;

ALTER TABLE public.auth_identities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.content_relationships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_entries ENABLE ROW LEVEL SECURITY;

drop policy if exists task_entries_domain_policy on public.task_entries;
CREATE POLICY task_entries_domain_policy ON public.task_entries TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_emails ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Grants. 20261126040000 carries these forward for objects a later migration creates;
-- state them explicitly so this file is correct on a database that ran it out of order.
grant select, insert, update, delete on table public.auth_identities to practice_manager_app;
grant select, insert, update, delete on table public.content_relationships to practice_manager_app;
grant select, insert, update, delete on table public.task_entries to practice_manager_app;
grant select, insert, update, delete on table public.user_credentials to practice_manager_app;
grant select, insert, update, delete on table public.user_emails to practice_manager_app;
grant select, insert, update, delete on table public.user_tokens to practice_manager_app;
grant select, insert, update, delete on table public.users to practice_manager_app;
grant select, usage on sequence public.content_relationships_id_seq to practice_manager_app;
grant select, usage on sequence public.task_entries_id_seq to practice_manager_app;
