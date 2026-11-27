-- Create the tables the routes used to create for themselves.
--
-- The baseline was dumped from a database built by `db:init` + `db:prepare`, so it holds what the
-- legacy initialisers create. Fourteen tables were only ever created by the route or store that
-- uses them (`CREATE TABLE IF NOT EXISTS` on first use). A branch is built from these files
-- alone, so those tables — and their policies — were missing there while they exist on the
-- hosted project.
--
-- The shape below is `pg_dump --schema-only` of the hosted project's catalog, so a branch built
-- from the migrations matches production. Every statement is idempotent, because the hosted
-- project already has these objects and both `db push` and `db:init` replay these files onto
-- databases that do.
--
-- Permissive policies whose only grantee was the database owner (`<table>_rls_policy`,
-- `USING (true)`) are deliberately not reproduced: `lib/rlsPolicies.js` drops them, and a
-- published permissive policy is what the RLS rollout exists to remove.
--
-- The routes that create these tables accept an overridden name (`PATIENT_REPORTS_TABLE` and
-- friends). This migration creates the default name; an override stays a runtime-only path.

CREATE SEQUENCE IF NOT EXISTS public.equipment_suppliers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE IF NOT EXISTS public.admin_notification_settings (
    username character varying(100) NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.admin_users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE IF NOT EXISTS public.admin_users (
    id integer DEFAULT nextval('public.admin_users_id_seq'::regclass) NOT NULL,
    username character varying(100) NOT NULL,
    password_hash text NOT NULL,
    role character varying(50) DEFAULT 'admin'::character varying NOT NULL,
    domain character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    email character varying(255),
    timezone character varying(100)
);

CREATE TABLE IF NOT EXISTS public.allied_health_provider_admin_deletions (
    id bigint NOT NULL,
    provider_id bigint NOT NULL,
    admin_key character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.allied_health_provider_admin_deletions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.allied_health_provider_admin_deletions_id_seq OWNED BY public.allied_health_provider_admin_deletions.id;

CREATE TABLE IF NOT EXISTS public.allied_health_provider_favorites (
    id bigint NOT NULL,
    provider_id bigint NOT NULL,
    admin_key character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.allied_health_provider_favorites_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.allied_health_provider_favorites_id_seq OWNED BY public.allied_health_provider_favorites.id;

CREATE TABLE IF NOT EXISTS public.allied_health_providers (
    id bigint NOT NULL,
    provider text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    professions text DEFAULT '[]'::text NOT NULL,
    service_types text DEFAULT '[]'::text NOT NULL,
    age_groups text DEFAULT '[]'::text NOT NULL,
    ndis_status character varying(40) DEFAULT ''::character varying NOT NULL,
    funding text DEFAULT '[]'::text NOT NULL,
    geography text DEFAULT '[]'::text NOT NULL,
    languages_spoken text DEFAULT '[]'::text NOT NULL,
    telehealth boolean DEFAULT false NOT NULL,
    home_visits boolean DEFAULT false NOT NULL,
    bulk_billing boolean DEFAULT false NOT NULL,
    accepting_new_clients boolean DEFAULT false NOT NULL,
    referral_required boolean DEFAULT false NOT NULL,
    registration_body character varying(120) DEFAULT ''::character varying NOT NULL,
    typical_wait_time character varying(120) DEFAULT ''::character varying NOT NULL,
    website_url text DEFAULT ''::text NOT NULL,
    email character varying(320) DEFAULT ''::character varying NOT NULL,
    phone character varying(80) DEFAULT ''::character varying NOT NULL,
    last_verified_at character varying(32) DEFAULT ''::character varying NOT NULL,
    status character varying(24) DEFAULT 'published'::character varying NOT NULL,
    domain character varying(120) DEFAULT ''::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.allied_health_providers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.allied_health_providers_id_seq OWNED BY public.allied_health_providers.id;

CREATE TABLE IF NOT EXISTS public.equipment_supplier_admin_deletions (
    id bigint NOT NULL,
    supplier_id bigint NOT NULL,
    admin_key character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.equipment_supplier_admin_deletions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.equipment_supplier_admin_deletions_id_seq OWNED BY public.equipment_supplier_admin_deletions.id;

CREATE TABLE IF NOT EXISTS public.equipment_supplier_favorites (
    id bigint NOT NULL,
    supplier_id bigint NOT NULL,
    admin_key character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.equipment_supplier_favorites_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.equipment_supplier_favorites_id_seq OWNED BY public.equipment_supplier_favorites.id;

CREATE TABLE IF NOT EXISTS public.equipment_suppliers (
    id bigint DEFAULT nextval('public.equipment_suppliers_id_seq'::regclass) NOT NULL,
    supplier text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    equipment_categories text DEFAULT '[]'::text NOT NULL,
    product_types text DEFAULT '[]'::text NOT NULL,
    professions text DEFAULT '[]'::text NOT NULL,
    ndis_status character varying(40) DEFAULT ''::character varying NOT NULL,
    geography text DEFAULT '[]'::text NOT NULL,
    home_trials boolean DEFAULT false NOT NULL,
    hire_rental boolean DEFAULT false NOT NULL,
    quotes boolean DEFAULT false NOT NULL,
    product_catalogue_url text DEFAULT ''::text NOT NULL,
    referral_contact text DEFAULT ''::text NOT NULL,
    typical_response_time character varying(120) DEFAULT ''::character varying NOT NULL,
    funding text DEFAULT '[]'::text NOT NULL,
    specialist_equipment text DEFAULT '[]'::text NOT NULL,
    repairs boolean DEFAULT false NOT NULL,
    website_url text DEFAULT ''::text NOT NULL,
    email character varying(320) DEFAULT ''::character varying NOT NULL,
    phone character varying(80) DEFAULT ''::character varying NOT NULL,
    brands text DEFAULT '[]'::text NOT NULL,
    delivery boolean DEFAULT false NOT NULL,
    trial_area text DEFAULT ''::text NOT NULL,
    last_verified_at character varying(32) DEFAULT ''::character varying NOT NULL,
    status character varying(24) DEFAULT 'published'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    domain character varying(120) DEFAULT ''::character varying NOT NULL
);

CREATE TABLE IF NOT EXISTS public.patient_analysis (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    status character varying(32) DEFAULT 'ready'::character varying NOT NULL,
    summary_text text,
    analysis_payload_json text DEFAULT '{}'::text NOT NULL,
    last_job_id bigint,
    source_notes_length integer DEFAULT 0 NOT NULL,
    transcript_count integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.patient_analysis_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.patient_analysis_id_seq OWNED BY public.patient_analysis.id;

CREATE TABLE IF NOT EXISTS public.patient_draft_invoices (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    summary_text text,
    draft_payload_json text DEFAULT '{}'::text NOT NULL,
    last_job_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.patient_draft_invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.patient_draft_invoices_id_seq OWNED BY public.patient_draft_invoices.id;

CREATE TABLE IF NOT EXISTS public.patient_equipment_suggestions (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    status character varying(32) DEFAULT 'ready'::character varying NOT NULL,
    suggestions_json text DEFAULT '[]'::text NOT NULL,
    source_report_id bigint,
    source_report_updated_at timestamp without time zone,
    last_job_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.patient_equipment_suggestions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.patient_equipment_suggestions_id_seq OWNED BY public.patient_equipment_suggestions.id;

CREATE TABLE IF NOT EXISTS public.patient_report_drafts (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint,
    patient_name text,
    report_markdown text NOT NULL,
    source_notes text,
    transcript_count integer DEFAULT 0 NOT NULL,
    source_metadata_json text DEFAULT '{}'::text NOT NULL,
    last_job_id bigint,
    status character varying(32) DEFAULT 'ready'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.patient_report_drafts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.patient_report_drafts_id_seq OWNED BY public.patient_report_drafts.id;

CREATE TABLE IF NOT EXISTS public.patient_reports (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    report_markdown text NOT NULL,
    source_notes text,
    transcript_count integer DEFAULT 0 NOT NULL,
    source_metadata_json text DEFAULT '{}'::text NOT NULL,
    last_job_id bigint,
    status character varying(32) DEFAULT 'ready'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.patient_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.patient_reports_id_seq OWNED BY public.patient_reports.id;

CREATE TABLE IF NOT EXISTS public.patient_transcript_summaries (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    transcription_id bigint NOT NULL,
    summary_style character varying(80) DEFAULT 'topic-bullets-third-person'::character varying NOT NULL,
    status character varying(32) DEFAULT 'ready'::character varying NOT NULL,
    summary_text text,
    summary_payload_json text DEFAULT '{}'::text NOT NULL,
    last_job_id bigint,
    source_text_length integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.patient_transcript_summaries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.patient_transcript_summaries_id_seq OWNED BY public.patient_transcript_summaries.id;

ALTER TABLE ONLY public.allied_health_provider_admin_deletions ALTER COLUMN id SET DEFAULT nextval('public.allied_health_provider_admin_deletions_id_seq'::regclass);

ALTER TABLE ONLY public.allied_health_provider_favorites ALTER COLUMN id SET DEFAULT nextval('public.allied_health_provider_favorites_id_seq'::regclass);

ALTER TABLE ONLY public.allied_health_providers ALTER COLUMN id SET DEFAULT nextval('public.allied_health_providers_id_seq'::regclass);

ALTER TABLE ONLY public.equipment_supplier_admin_deletions ALTER COLUMN id SET DEFAULT nextval('public.equipment_supplier_admin_deletions_id_seq'::regclass);

ALTER TABLE ONLY public.equipment_supplier_favorites ALTER COLUMN id SET DEFAULT nextval('public.equipment_supplier_favorites_id_seq'::regclass);

ALTER TABLE ONLY public.patient_analysis ALTER COLUMN id SET DEFAULT nextval('public.patient_analysis_id_seq'::regclass);

ALTER TABLE ONLY public.patient_draft_invoices ALTER COLUMN id SET DEFAULT nextval('public.patient_draft_invoices_id_seq'::regclass);

ALTER TABLE ONLY public.patient_equipment_suggestions ALTER COLUMN id SET DEFAULT nextval('public.patient_equipment_suggestions_id_seq'::regclass);

ALTER TABLE ONLY public.patient_report_drafts ALTER COLUMN id SET DEFAULT nextval('public.patient_report_drafts_id_seq'::regclass);

ALTER TABLE ONLY public.patient_reports ALTER COLUMN id SET DEFAULT nextval('public.patient_reports_id_seq'::regclass);

ALTER TABLE ONLY public.patient_transcript_summaries ALTER COLUMN id SET DEFAULT nextval('public.patient_transcript_summaries_id_seq'::regclass);

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'admin_notification_settings_pkey'
        and conrelid = 'public.admin_notification_settings'::regclass) then
        ALTER TABLE ONLY public.admin_notification_settings
    ADD CONSTRAINT admin_notification_settings_pkey PRIMARY KEY (username);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'allied_health_provider_admin_deletion_provider_id_admin_key_key'
        and conrelid = 'public.allied_health_provider_admin_deletions'::regclass) then
        ALTER TABLE ONLY public.allied_health_provider_admin_deletions
    ADD CONSTRAINT allied_health_provider_admin_deletion_provider_id_admin_key_key UNIQUE (provider_id, admin_key);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'allied_health_provider_admin_deletions_pkey'
        and conrelid = 'public.allied_health_provider_admin_deletions'::regclass) then
        ALTER TABLE ONLY public.allied_health_provider_admin_deletions
    ADD CONSTRAINT allied_health_provider_admin_deletions_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'allied_health_provider_favorites_pkey'
        and conrelid = 'public.allied_health_provider_favorites'::regclass) then
        ALTER TABLE ONLY public.allied_health_provider_favorites
    ADD CONSTRAINT allied_health_provider_favorites_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'allied_health_provider_favorites_provider_id_admin_key_key'
        and conrelid = 'public.allied_health_provider_favorites'::regclass) then
        ALTER TABLE ONLY public.allied_health_provider_favorites
    ADD CONSTRAINT allied_health_provider_favorites_provider_id_admin_key_key UNIQUE (provider_id, admin_key);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'allied_health_providers_pkey'
        and conrelid = 'public.allied_health_providers'::regclass) then
        ALTER TABLE ONLY public.allied_health_providers
    ADD CONSTRAINT allied_health_providers_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'equipment_supplier_admin_deletions_pkey'
        and conrelid = 'public.equipment_supplier_admin_deletions'::regclass) then
        ALTER TABLE ONLY public.equipment_supplier_admin_deletions
    ADD CONSTRAINT equipment_supplier_admin_deletions_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'equipment_supplier_admin_deletions_supplier_id_admin_key_key'
        and conrelid = 'public.equipment_supplier_admin_deletions'::regclass) then
        ALTER TABLE ONLY public.equipment_supplier_admin_deletions
    ADD CONSTRAINT equipment_supplier_admin_deletions_supplier_id_admin_key_key UNIQUE (supplier_id, admin_key);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'equipment_supplier_favorites_pkey'
        and conrelid = 'public.equipment_supplier_favorites'::regclass) then
        ALTER TABLE ONLY public.equipment_supplier_favorites
    ADD CONSTRAINT equipment_supplier_favorites_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'equipment_supplier_favorites_supplier_id_admin_key_key'
        and conrelid = 'public.equipment_supplier_favorites'::regclass) then
        ALTER TABLE ONLY public.equipment_supplier_favorites
    ADD CONSTRAINT equipment_supplier_favorites_supplier_id_admin_key_key UNIQUE (supplier_id, admin_key);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'equipment_suppliers_id_key'
        and conrelid = 'public.equipment_suppliers'::regclass) then
        ALTER TABLE ONLY public.equipment_suppliers
    ADD CONSTRAINT equipment_suppliers_id_key PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_analysis_domain_patient_unique'
        and conrelid = 'public.patient_analysis'::regclass) then
        ALTER TABLE ONLY public.patient_analysis
    ADD CONSTRAINT patient_analysis_domain_patient_unique UNIQUE (domain, patient_id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_analysis_pkey'
        and conrelid = 'public.patient_analysis'::regclass) then
        ALTER TABLE ONLY public.patient_analysis
    ADD CONSTRAINT patient_analysis_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_draft_invoices_domain_patient_unique'
        and conrelid = 'public.patient_draft_invoices'::regclass) then
        ALTER TABLE ONLY public.patient_draft_invoices
    ADD CONSTRAINT patient_draft_invoices_domain_patient_unique UNIQUE (domain, patient_id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_draft_invoices_pkey'
        and conrelid = 'public.patient_draft_invoices'::regclass) then
        ALTER TABLE ONLY public.patient_draft_invoices
    ADD CONSTRAINT patient_draft_invoices_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_equipment_suggestions_domain_patient_unique'
        and conrelid = 'public.patient_equipment_suggestions'::regclass) then
        ALTER TABLE ONLY public.patient_equipment_suggestions
    ADD CONSTRAINT patient_equipment_suggestions_domain_patient_unique UNIQUE (domain, patient_id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_equipment_suggestions_pkey'
        and conrelid = 'public.patient_equipment_suggestions'::regclass) then
        ALTER TABLE ONLY public.patient_equipment_suggestions
    ADD CONSTRAINT patient_equipment_suggestions_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_report_drafts_pkey'
        and conrelid = 'public.patient_report_drafts'::regclass) then
        ALTER TABLE ONLY public.patient_report_drafts
    ADD CONSTRAINT patient_report_drafts_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_reports_domain_patient_unique'
        and conrelid = 'public.patient_reports'::regclass) then
        ALTER TABLE ONLY public.patient_reports
    ADD CONSTRAINT patient_reports_domain_patient_unique UNIQUE (domain, patient_id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_reports_pkey'
        and conrelid = 'public.patient_reports'::regclass) then
        ALTER TABLE ONLY public.patient_reports
    ADD CONSTRAINT patient_reports_pkey PRIMARY KEY (id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_transcript_summaries_domain_transcription_style_unique'
        and conrelid = 'public.patient_transcript_summaries'::regclass) then
        ALTER TABLE ONLY public.patient_transcript_summaries
    ADD CONSTRAINT patient_transcript_summaries_domain_transcription_style_unique UNIQUE (domain, transcription_id, summary_style);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'patient_transcript_summaries_pkey'
        and conrelid = 'public.patient_transcript_summaries'::regclass) then
        ALTER TABLE ONLY public.patient_transcript_summaries
    ADD CONSTRAINT patient_transcript_summaries_pkey PRIMARY KEY (id);
    end if;
end $$;

CREATE INDEX IF NOT EXISTS patient_analysis_domain_patient_idx ON public.patient_analysis USING btree (domain, patient_id);

CREATE INDEX IF NOT EXISTS patient_analysis_updated_idx ON public.patient_analysis USING btree (updated_at);

CREATE INDEX IF NOT EXISTS patient_draft_invoices_domain_patient_idx ON public.patient_draft_invoices USING btree (domain, patient_id);

CREATE INDEX IF NOT EXISTS patient_draft_invoices_updated_idx ON public.patient_draft_invoices USING btree (updated_at);

CREATE INDEX IF NOT EXISTS patient_report_drafts_domain_patient_idx ON public.patient_report_drafts USING btree (domain, patient_id);

CREATE UNIQUE INDEX IF NOT EXISTS patient_report_drafts_domain_patient_job_unique ON public.patient_report_drafts USING btree (domain, patient_id, last_job_id) WHERE (last_job_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS patient_report_drafts_updated_idx ON public.patient_report_drafts USING btree (updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS patient_report_drafts_working_draft_unique ON public.patient_report_drafts USING btree (domain, patient_id) WHERE (last_job_id IS NULL);

CREATE INDEX IF NOT EXISTS patient_reports_domain_patient_idx ON public.patient_reports USING btree (domain, patient_id);

CREATE INDEX IF NOT EXISTS patient_reports_updated_idx ON public.patient_reports USING btree (updated_at);

CREATE INDEX IF NOT EXISTS patient_transcript_summaries_domain_patient_idx ON public.patient_transcript_summaries USING btree (domain, patient_id);

CREATE INDEX IF NOT EXISTS patient_transcript_summaries_updated_idx ON public.patient_transcript_summaries USING btree (updated_at);

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'allied_health_provider_admin_deletions_provider_id_fkey'
        and conrelid = 'public.allied_health_provider_admin_deletions'::regclass) then
        ALTER TABLE ONLY public.allied_health_provider_admin_deletions
    ADD CONSTRAINT allied_health_provider_admin_deletions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.allied_health_providers(id) ON DELETE CASCADE;
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'allied_health_provider_favorites_provider_id_fkey'
        and conrelid = 'public.allied_health_provider_favorites'::regclass) then
        ALTER TABLE ONLY public.allied_health_provider_favorites
    ADD CONSTRAINT allied_health_provider_favorites_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.allied_health_providers(id) ON DELETE CASCADE;
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'equipment_supplier_admin_deletions_supplier_id_fkey'
        and conrelid = 'public.equipment_supplier_admin_deletions'::regclass) then
        ALTER TABLE ONLY public.equipment_supplier_admin_deletions
    ADD CONSTRAINT equipment_supplier_admin_deletions_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.equipment_suppliers(id) ON DELETE CASCADE;
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'equipment_supplier_favorites_supplier_id_fkey'
        and conrelid = 'public.equipment_supplier_favorites'::regclass) then
        ALTER TABLE ONLY public.equipment_supplier_favorites
    ADD CONSTRAINT equipment_supplier_favorites_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.equipment_suppliers(id) ON DELETE CASCADE;
    end if;
end $$;

ALTER TABLE public.admin_notification_settings ENABLE ROW LEVEL SECURITY;

drop policy if exists admin_notification_settings_self_policy on public.admin_notification_settings;
CREATE POLICY admin_notification_settings_self_policy ON public.admin_notification_settings TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((username)::text = current_setting('app.current_username'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((username)::text = current_setting('app.current_username'::text, true))));

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

drop policy if exists admin_users_delete_policy on public.admin_users;
CREATE POLICY admin_users_delete_policy ON public.admin_users FOR DELETE TO practice_manager_app USING ((current_setting('app.current_role'::text, true) = 'superadmin'::text));

drop policy if exists admin_users_insert_policy on public.admin_users;
CREATE POLICY admin_users_insert_policy ON public.admin_users FOR INSERT TO practice_manager_app WITH CHECK ((current_setting('app.current_role'::text, true) = 'superadmin'::text));

drop policy if exists admin_users_read_policy on public.admin_users;
CREATE POLICY admin_users_read_policy ON public.admin_users FOR SELECT TO practice_manager_app USING (true);

drop policy if exists admin_users_update_policy on public.admin_users;
CREATE POLICY admin_users_update_policy ON public.admin_users FOR UPDATE TO practice_manager_app USING ((current_setting('app.current_role'::text, true) = 'superadmin'::text)) WITH CHECK ((current_setting('app.current_role'::text, true) = 'superadmin'::text));

ALTER TABLE public.allied_health_provider_admin_deletions ENABLE ROW LEVEL SECURITY;

drop policy if exists allied_health_provider_admin_deletions_delete_policy on public.allied_health_provider_admin_deletions;
CREATE POLICY allied_health_provider_admin_deletions_delete_policy ON public.allied_health_provider_admin_deletions FOR DELETE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.allied_health_providers parent
  WHERE (parent.id = allied_health_provider_admin_deletions.provider_id)))));

drop policy if exists allied_health_provider_admin_deletions_insert_policy on public.allied_health_provider_admin_deletions;
CREATE POLICY allied_health_provider_admin_deletions_insert_policy ON public.allied_health_provider_admin_deletions FOR INSERT TO practice_manager_app WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.allied_health_providers parent
  WHERE (parent.id = allied_health_provider_admin_deletions.provider_id)))));

drop policy if exists allied_health_provider_admin_deletions_read_policy on public.allied_health_provider_admin_deletions;
CREATE POLICY allied_health_provider_admin_deletions_read_policy ON public.allied_health_provider_admin_deletions FOR SELECT TO practice_manager_app USING (true);

drop policy if exists allied_health_provider_admin_deletions_update_policy on public.allied_health_provider_admin_deletions;
CREATE POLICY allied_health_provider_admin_deletions_update_policy ON public.allied_health_provider_admin_deletions FOR UPDATE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.allied_health_providers parent
  WHERE (parent.id = allied_health_provider_admin_deletions.provider_id))))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.allied_health_providers parent
  WHERE (parent.id = allied_health_provider_admin_deletions.provider_id)))));

ALTER TABLE public.allied_health_provider_favorites ENABLE ROW LEVEL SECURITY;

drop policy if exists allied_health_provider_favorites_delete_policy on public.allied_health_provider_favorites;
CREATE POLICY allied_health_provider_favorites_delete_policy ON public.allied_health_provider_favorites FOR DELETE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.allied_health_providers parent
  WHERE (parent.id = allied_health_provider_favorites.provider_id)))));

drop policy if exists allied_health_provider_favorites_insert_policy on public.allied_health_provider_favorites;
CREATE POLICY allied_health_provider_favorites_insert_policy ON public.allied_health_provider_favorites FOR INSERT TO practice_manager_app WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.allied_health_providers parent
  WHERE (parent.id = allied_health_provider_favorites.provider_id)))));

drop policy if exists allied_health_provider_favorites_read_policy on public.allied_health_provider_favorites;
CREATE POLICY allied_health_provider_favorites_read_policy ON public.allied_health_provider_favorites FOR SELECT TO practice_manager_app USING (true);

drop policy if exists allied_health_provider_favorites_update_policy on public.allied_health_provider_favorites;
CREATE POLICY allied_health_provider_favorites_update_policy ON public.allied_health_provider_favorites FOR UPDATE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.allied_health_providers parent
  WHERE (parent.id = allied_health_provider_favorites.provider_id))))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.allied_health_providers parent
  WHERE (parent.id = allied_health_provider_favorites.provider_id)))));

ALTER TABLE public.allied_health_providers ENABLE ROW LEVEL SECURITY;

drop policy if exists allied_health_providers_delete_policy on public.allied_health_providers;
CREATE POLICY allied_health_providers_delete_policy ON public.allied_health_providers FOR DELETE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL) OR ((domain)::text = ''::text)));

drop policy if exists allied_health_providers_insert_policy on public.allied_health_providers;
CREATE POLICY allied_health_providers_insert_policy ON public.allied_health_providers FOR INSERT TO practice_manager_app WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL) OR ((domain)::text = ''::text)));

drop policy if exists allied_health_providers_read_policy on public.allied_health_providers;
CREATE POLICY allied_health_providers_read_policy ON public.allied_health_providers FOR SELECT TO practice_manager_app USING (true);

drop policy if exists allied_health_providers_update_policy on public.allied_health_providers;
CREATE POLICY allied_health_providers_update_policy ON public.allied_health_providers FOR UPDATE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL) OR ((domain)::text = ''::text))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL) OR ((domain)::text = ''::text)));

ALTER TABLE public.equipment_supplier_admin_deletions ENABLE ROW LEVEL SECURITY;

drop policy if exists equipment_supplier_admin_deletions_delete_policy on public.equipment_supplier_admin_deletions;
CREATE POLICY equipment_supplier_admin_deletions_delete_policy ON public.equipment_supplier_admin_deletions FOR DELETE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.equipment_suppliers parent
  WHERE (parent.id = equipment_supplier_admin_deletions.supplier_id)))));

drop policy if exists equipment_supplier_admin_deletions_insert_policy on public.equipment_supplier_admin_deletions;
CREATE POLICY equipment_supplier_admin_deletions_insert_policy ON public.equipment_supplier_admin_deletions FOR INSERT TO practice_manager_app WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.equipment_suppliers parent
  WHERE (parent.id = equipment_supplier_admin_deletions.supplier_id)))));

drop policy if exists equipment_supplier_admin_deletions_read_policy on public.equipment_supplier_admin_deletions;
CREATE POLICY equipment_supplier_admin_deletions_read_policy ON public.equipment_supplier_admin_deletions FOR SELECT TO practice_manager_app USING (true);

drop policy if exists equipment_supplier_admin_deletions_update_policy on public.equipment_supplier_admin_deletions;
CREATE POLICY equipment_supplier_admin_deletions_update_policy ON public.equipment_supplier_admin_deletions FOR UPDATE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.equipment_suppliers parent
  WHERE (parent.id = equipment_supplier_admin_deletions.supplier_id))))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.equipment_suppliers parent
  WHERE (parent.id = equipment_supplier_admin_deletions.supplier_id)))));

ALTER TABLE public.equipment_supplier_favorites ENABLE ROW LEVEL SECURITY;

drop policy if exists equipment_supplier_favorites_delete_policy on public.equipment_supplier_favorites;
CREATE POLICY equipment_supplier_favorites_delete_policy ON public.equipment_supplier_favorites FOR DELETE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.equipment_suppliers parent
  WHERE (parent.id = equipment_supplier_favorites.supplier_id)))));

drop policy if exists equipment_supplier_favorites_insert_policy on public.equipment_supplier_favorites;
CREATE POLICY equipment_supplier_favorites_insert_policy ON public.equipment_supplier_favorites FOR INSERT TO practice_manager_app WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.equipment_suppliers parent
  WHERE (parent.id = equipment_supplier_favorites.supplier_id)))));

drop policy if exists equipment_supplier_favorites_read_policy on public.equipment_supplier_favorites;
CREATE POLICY equipment_supplier_favorites_read_policy ON public.equipment_supplier_favorites FOR SELECT TO practice_manager_app USING (true);

drop policy if exists equipment_supplier_favorites_update_policy on public.equipment_supplier_favorites;
CREATE POLICY equipment_supplier_favorites_update_policy ON public.equipment_supplier_favorites FOR UPDATE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.equipment_suppliers parent
  WHERE (parent.id = equipment_supplier_favorites.supplier_id))))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (EXISTS ( SELECT 1
   FROM public.equipment_suppliers parent
  WHERE (parent.id = equipment_supplier_favorites.supplier_id)))));

ALTER TABLE public.equipment_suppliers ENABLE ROW LEVEL SECURITY;

drop policy if exists equipment_suppliers_delete_policy on public.equipment_suppliers;
CREATE POLICY equipment_suppliers_delete_policy ON public.equipment_suppliers FOR DELETE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL) OR ((domain)::text = ''::text)));

drop policy if exists equipment_suppliers_insert_policy on public.equipment_suppliers;
CREATE POLICY equipment_suppliers_insert_policy ON public.equipment_suppliers FOR INSERT TO practice_manager_app WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL) OR ((domain)::text = ''::text)));

drop policy if exists equipment_suppliers_read_policy on public.equipment_suppliers;
CREATE POLICY equipment_suppliers_read_policy ON public.equipment_suppliers FOR SELECT TO practice_manager_app USING (true);

drop policy if exists equipment_suppliers_update_policy on public.equipment_suppliers;
CREATE POLICY equipment_suppliers_update_policy ON public.equipment_suppliers FOR UPDATE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL) OR ((domain)::text = ''::text))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL) OR ((domain)::text = ''::text)));

ALTER TABLE public.patient_analysis ENABLE ROW LEVEL SECURITY;

drop policy if exists patient_analysis_domain_policy on public.patient_analysis;
CREATE POLICY patient_analysis_domain_policy ON public.patient_analysis TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

ALTER TABLE public.patient_draft_invoices ENABLE ROW LEVEL SECURITY;

drop policy if exists patient_draft_invoices_domain_policy on public.patient_draft_invoices;
CREATE POLICY patient_draft_invoices_domain_policy ON public.patient_draft_invoices TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

ALTER TABLE public.patient_equipment_suggestions ENABLE ROW LEVEL SECURITY;

drop policy if exists patient_equipment_suggestions_domain_policy on public.patient_equipment_suggestions;
CREATE POLICY patient_equipment_suggestions_domain_policy ON public.patient_equipment_suggestions TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

ALTER TABLE public.patient_report_drafts ENABLE ROW LEVEL SECURITY;

drop policy if exists patient_report_drafts_domain_policy on public.patient_report_drafts;
CREATE POLICY patient_report_drafts_domain_policy ON public.patient_report_drafts TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

ALTER TABLE public.patient_reports ENABLE ROW LEVEL SECURITY;

drop policy if exists patient_reports_domain_policy on public.patient_reports;
CREATE POLICY patient_reports_domain_policy ON public.patient_reports TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

ALTER TABLE public.patient_transcript_summaries ENABLE ROW LEVEL SECURITY;

drop policy if exists patient_transcript_summaries_domain_policy on public.patient_transcript_summaries;
CREATE POLICY patient_transcript_summaries_domain_policy ON public.patient_transcript_summaries TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

-- Grants. 20261126040000 carries these forward for objects a later migration creates;
-- these tables already exist on the hosted project, so state them explicitly.
grant select, insert, update, delete on table public.admin_notification_settings to practice_manager_app;
grant select, insert, update, delete on table public.admin_users to practice_manager_app;
grant select, insert, update, delete on table public.allied_health_provider_admin_deletions to practice_manager_app;
grant select, insert, update, delete on table public.allied_health_provider_favorites to practice_manager_app;
grant select, insert, update, delete on table public.allied_health_providers to practice_manager_app;
grant select, insert, update, delete on table public.equipment_supplier_admin_deletions to practice_manager_app;
grant select, insert, update, delete on table public.equipment_supplier_favorites to practice_manager_app;
grant select, insert, update, delete on table public.equipment_suppliers to practice_manager_app;
grant select, insert, update, delete on table public.patient_analysis to practice_manager_app;
grant select, insert, update, delete on table public.patient_draft_invoices to practice_manager_app;
grant select, insert, update, delete on table public.patient_equipment_suggestions to practice_manager_app;
grant select, insert, update, delete on table public.patient_report_drafts to practice_manager_app;
grant select, insert, update, delete on table public.patient_reports to practice_manager_app;
grant select, insert, update, delete on table public.patient_transcript_summaries to practice_manager_app;
grant select, usage on sequence public.admin_users_id_seq to practice_manager_app;
grant select, usage on sequence public.allied_health_provider_admin_deletions_id_seq to practice_manager_app;
grant select, usage on sequence public.allied_health_provider_favorites_id_seq to practice_manager_app;
grant select, usage on sequence public.allied_health_providers_id_seq to practice_manager_app;
grant select, usage on sequence public.equipment_supplier_admin_deletions_id_seq to practice_manager_app;
grant select, usage on sequence public.equipment_supplier_favorites_id_seq to practice_manager_app;
grant select, usage on sequence public.patient_analysis_id_seq to practice_manager_app;
grant select, usage on sequence public.patient_draft_invoices_id_seq to practice_manager_app;
grant select, usage on sequence public.patient_equipment_suggestions_id_seq to practice_manager_app;
grant select, usage on sequence public.patient_report_drafts_id_seq to practice_manager_app;
grant select, usage on sequence public.patient_reports_id_seq to practice_manager_app;
grant select, usage on sequence public.patient_transcript_summaries_id_seq to practice_manager_app;
grant select, usage on sequence public.equipment_suppliers_id_seq to practice_manager_app;
