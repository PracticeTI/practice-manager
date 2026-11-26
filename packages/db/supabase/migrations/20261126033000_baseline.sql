-- Baseline: the schema the application creates, captured from a database built by the
-- table bootstrap (`bootstrapSchema`) and `npm run db:prepare` with no private overlay
-- mounted, then dumped with PostgreSQL 14 / pg_dump 14.20 (--schema-only --no-owner
-- --no-comments).
--
-- This is the migration of record for every environment. Supabase builds a preview branch
-- from `supabase/migrations` alone; the app's runner (`npm run db:init`,
-- apps/core/src/lib/migrations.js) applies the same files to Docker, LAN and desktop installs.
-- Nothing here may depend on a Supabase-only object (the `auth` schema,
-- `supabase_migrations`, `vault`), because those installs are plain PostgreSQL.
--
-- Captured without the overlay on purpose. The overlay can change a schema default — it is
-- what sets the fallback content domain (`content.domain` below) — and a customer name must
-- never reach this published directory. A branded deployment that wants its own default sets
-- it in an unpublished migration or with `alter table public.content alter column domain set
-- default '<key>'`.
--
-- `practice_manager_app` is the runtime role that the policies and grants below name. It is
-- created without LOGIN so a fresh branch or install has the role; give it a login out of band
-- (docs/postgres-rls-rollout.md, step 2).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'practice_manager_app') then
    create role practice_manager_app nologin;
  end if;
end
$$;


-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    actor_type character varying(24) DEFAULT 'human'::character varying NOT NULL,
    actor_id character varying(160),
    actor_name character varying(255),
    actor_role character varying(64),
    action character varying(32) NOT NULL,
    entity_type character varying(64) NOT NULL,
    entity_id character varying(160),
    entity_label character varying(255),
    patient_id integer,
    patient_name character varying(255),
    deep_link text,
    summary text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: activities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activities_id_seq OWNED BY public.activities.id;

--
-- Name: admin_suppressed_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_suppressed_notifications (
    id bigint NOT NULL,
    domain character varying(100),
    notification_type character varying(80) NOT NULL,
    category character varying(80),
    title text,
    summary text,
    recipients text,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: admin_suppressed_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_suppressed_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: admin_suppressed_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_suppressed_notifications_id_seq OWNED BY public.admin_suppressed_notifications.id;

--
-- Name: api_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_rate_limits (
    bucket_key character varying(200) NOT NULL,
    window_started_at timestamp with time zone DEFAULT now() NOT NULL,
    request_count integer DEFAULT 0 NOT NULL
);

--
-- Name: appointment_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_reminders (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    appointment_id integer NOT NULL,
    patient_id integer,
    kind character varying(24) DEFAULT 'reminder'::character varying NOT NULL,
    channel character varying(16) DEFAULT 'auto'::character varying NOT NULL,
    offset_hours integer NOT NULL,
    appointment_starts_at timestamp with time zone NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    status character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    sent_at timestamp with time zone,
    provider character varying(32),
    provider_message_id text,
    error_message text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: appointment_reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.appointment_reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: appointment_reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.appointment_reminders_id_seq OWNED BY public.appointment_reminders.id;

--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    external_id character varying(120),
    external_source character varying(64) DEFAULT 'manual'::character varying NOT NULL,
    patient_id integer,
    patient_name character varying(255),
    external_patient_id character varying(120),
    practitioner character varying(255),
    external_practitioner_id character varying(120),
    service character varying(255),
    external_service_id character varying(120),
    location character varying(255),
    external_location_id character varying(120),
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    progress_note_status character varying(32),
    patient_status character varying(32),
    unavailable_block boolean DEFAULT false NOT NULL,
    is_group boolean DEFAULT false NOT NULL,
    is_repeating boolean DEFAULT false NOT NULL,
    repeating_rule character varying(255),
    max_patients integer,
    price numeric(12,2),
    unit character varying(32),
    tax_type character varying(64),
    tax_rate numeric(6,3),
    notes text,
    archived boolean DEFAULT false NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    practitioner_id integer,
    location_id integer,
    service_id integer,
    case_id integer,
    appointment_status character varying(24) DEFAULT 'confirmed'::character varying NOT NULL,
    booking_source character varying(32) DEFAULT 'manual'::character varying NOT NULL,
    booked_by character varying(255),
    arrived_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    telehealth_url text,
    recurrence_id integer,
    timezone character varying(100) DEFAULT 'Australia/Sydney'::character varying NOT NULL,
    confirmation_status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    confirmed_at timestamp with time zone,
    confirmation_channel character varying(32)
);

--
-- Name: appointments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.appointments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: appointments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.appointments_id_seq OWNED BY public.appointments.id;

--
-- Name: auth_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(32) NOT NULL,
    provider_account_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: availability_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability_exceptions (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    practitioner_id integer NOT NULL,
    exception_type character varying(24) DEFAULT 'leave'::character varying NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    note text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT availability_exceptions_time_order CHECK ((ends_at > starts_at))
);

--
-- Name: availability_exceptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.availability_exceptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: availability_exceptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.availability_exceptions_id_seq OWNED BY public.availability_exceptions.id;

--
-- Name: availability_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability_rules (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    practitioner_id integer NOT NULL,
    location_id integer,
    service_id integer,
    weekday smallint NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    valid_from date,
    valid_to date,
    rrule character varying(255),
    active boolean DEFAULT true NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT availability_rules_time_order CHECK ((end_time > start_time)),
    CONSTRAINT availability_rules_weekday_range CHECK (((weekday >= 0) AND (weekday <= 6)))
);

--
-- Name: availability_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.availability_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: availability_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.availability_rules_id_seq OWNED BY public.availability_rules.id;

--
-- Name: billing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    account_id character varying(255) NOT NULL,
    account_name character varying(255),
    metadata jsonb
);

--
-- Name: billing_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: billing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_id_seq OWNED BY public.billing.id;

--
-- Name: calendar_busy_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_busy_blocks (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    connection_id integer NOT NULL,
    practitioner_id integer NOT NULL,
    external_event_id character varying(255),
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    busy_status character varying(16) DEFAULT 'busy'::character varying NOT NULL,
    title character varying(255),
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb,
    CONSTRAINT calendar_busy_blocks_time_order CHECK ((ends_at > starts_at))
);

--
-- Name: calendar_busy_blocks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.calendar_busy_blocks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: calendar_busy_blocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.calendar_busy_blocks_id_seq OWNED BY public.calendar_busy_blocks.id;

--
-- Name: calendar_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_connections (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    practitioner_id integer NOT NULL,
    provider character varying(24) NOT NULL,
    external_account_email character varying(255),
    access_token_encrypted text NOT NULL,
    refresh_token_encrypted text,
    token_expires_at timestamp with time zone,
    scopes text,
    status character varying(24) DEFAULT 'connected'::character varying NOT NULL,
    last_synced_at timestamp with time zone,
    last_sync_error text,
    sync_window_days integer DEFAULT 60 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: calendar_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.calendar_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: calendar_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.calendar_connections_id_seq OWNED BY public.calendar_connections.id;

--
-- Name: case_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.case_usage (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    case_id integer NOT NULL,
    patient_id integer NOT NULL,
    entry_date date NOT NULL,
    description character varying(255),
    quantity numeric(12,2) DEFAULT 0 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: case_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.case_usage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: case_usage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.case_usage_id_seq OWNED BY public.case_usage.id;

--
-- Name: chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chats (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    role character varying(50) NOT NULL,
    session_id character varying(255),
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb,
    status character varying(50) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: chats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: chats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chats_id_seq OWNED BY public.chats.id;

--
-- Name: contact_patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_patients (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    contact_id integer NOT NULL,
    patient_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: contact_patients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_patients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: contact_patients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_patients_id_seq OWNED BY public.contact_patients.id;

--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    name character varying(255) DEFAULT ''::character varying NOT NULL,
    email character varying(320) DEFAULT ''::character varying NOT NULL,
    phone character varying(64) DEFAULT ''::character varying NOT NULL,
    association character varying(255) DEFAULT ''::character varying NOT NULL,
    role character varying(160) DEFAULT ''::character varying NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contacts_id_seq OWNED BY public.contacts.id;

--
-- Name: content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content (
    id integer NOT NULL,
    type character varying(50) NOT NULL,
    subtype character varying(50),
    domain character varying(64) DEFAULT 'default'::character varying NOT NULL,
    slug character varying(255) NOT NULL,
    title character varying(255),
    name character varying(255),
    summary text,
    body text,
    status character varying(50) DEFAULT 'draft'::character varying,
    published_at timestamp with time zone,
    attributes jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: content_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.content_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: content_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.content_id_seq OWNED BY public.content.id;

--
-- Name: content_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_relationships (
    id integer NOT NULL,
    source_id integer NOT NULL,
    target_id integer NOT NULL,
    relationship_type character varying(50) NOT NULL,
    role character varying(255),
    "position" integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: content_relationships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.content_relationships_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: content_relationships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.content_relationships_id_seq OWNED BY public.content_relationships.id;

--
-- Name: domain_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.domain_settings (
    domain character varying(100) NOT NULL,
    key character varying(255) NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forms (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    external_id character varying(120),
    external_source character varying(64) DEFAULT 'manual'::character varying NOT NULL,
    title character varying(255),
    submitted_message text,
    submitted_at timestamp with time zone,
    patient_id integer,
    patient_name character varying(255),
    external_patient_id character varying(120),
    archived boolean DEFAULT false NOT NULL,
    content jsonb,
    answers jsonb,
    labelled_answers jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: forms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.forms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: forms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.forms_id_seq OWNED BY public.forms.id;

--
-- Name: funder_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funder_documents (
    id bigint NOT NULL,
    funder_id bigint NOT NULL,
    key character varying(120) DEFAULT ''::character varying NOT NULL,
    title character varying(255) DEFAULT ''::character varying NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    category character varying(64) DEFAULT 'reference'::character varying NOT NULL,
    doc_type character varying(32) DEFAULT 'link'::character varying NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    effective_period character varying(32) DEFAULT ''::character varying NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    status character varying(24) DEFAULT 'published'::character varying NOT NULL,
    link_status character varying(24) DEFAULT ''::character varying NOT NULL,
    http_status integer,
    link_checked_at timestamp with time zone,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: funder_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.funder_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: funder_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.funder_documents_id_seq OWNED BY public.funder_documents.id;

--
-- Name: funders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funders (
    id bigint NOT NULL,
    key character varying(64) NOT NULL,
    name character varying(160) DEFAULT ''::character varying NOT NULL,
    full_name character varying(255) DEFAULT ''::character varying NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    jurisdiction character varying(160) DEFAULT ''::character varying NOT NULL,
    website_url text DEFAULT ''::text NOT NULL,
    status character varying(24) DEFAULT 'published'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: funders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.funders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: funders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.funders_id_seq OWNED BY public.funders.id;

--
-- Name: inbound_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbound_messages (
    id bigint NOT NULL,
    status character varying(32) DEFAULT 'received'::character varying NOT NULL,
    from_email character varying(320) NOT NULL,
    to_email character varying(320) NOT NULL,
    domain character varying(100),
    subject text,
    text_body text,
    html_body text,
    payload_json jsonb DEFAULT '{}'::jsonb,
    category character varying(80) DEFAULT 'generic'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5,
    next_attempt_at timestamp with time zone,
    claimed_at timestamp with time zone,
    claimed_by character varying(128),
    processed_at timestamp with time zone,
    provider character varying(32) DEFAULT 'resend'::character varying NOT NULL,
    provider_message_id text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: inbound_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbound_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: inbound_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbound_messages_id_seq OWNED BY public.inbound_messages.id;

--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    external_id character varying(120),
    external_source character varying(64) DEFAULT 'manual'::character varying NOT NULL,
    title character varying(255),
    draft boolean DEFAULT false NOT NULL,
    content jsonb,
    content_text text,
    patient_id integer,
    patient_name character varying(255),
    external_patient_id character varying(120),
    external_appointment_id character varying(120),
    practitioner_name character varying(255),
    external_practitioner_id character varying(120),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notes_id_seq OWNED BY public.notes.id;

--
-- Name: outbound_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound_messages (
    id bigint NOT NULL,
    status character varying(32) DEFAULT 'queued'::character varying NOT NULL,
    to_email character varying(320) NOT NULL,
    category character varying(80) DEFAULT 'generic'::character varying NOT NULL,
    domain character varying(100),
    subject text,
    text_body text,
    html_body text,
    payload_json text DEFAULT '{}'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer,
    next_attempt_at timestamp with time zone,
    claimed_at timestamp with time zone,
    claimed_by character varying(128),
    sent_at timestamp with time zone,
    provider character varying(32),
    provider_message_id text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp without time zone,
    reviewed_by character varying(128)
);

--
-- Name: outbound_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outbound_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: outbound_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outbound_messages_id_seq OWNED BY public.outbound_messages.id;

--
-- Name: patient_analysis_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_analysis_jobs (
    id bigint NOT NULL,
    status character varying(32) DEFAULT 'queued'::character varying NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    event_type character varying(80) DEFAULT 'analyst_enabled'::character varying NOT NULL,
    requested_action character varying(80) DEFAULT 'prepare_fca_suggestions'::character varying NOT NULL,
    payload_json text DEFAULT '{}'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer,
    next_attempt_at timestamp without time zone,
    claimed_at timestamp without time zone,
    claimed_by character varying(128),
    completed_at timestamp without time zone,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: patient_analysis_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_analysis_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_analysis_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_analysis_jobs_id_seq OWNED BY public.patient_analysis_jobs.id;

--
-- Name: patient_billing_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_billing_jobs (
    id bigint NOT NULL,
    status character varying(32) DEFAULT 'queued'::character varying NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    event_type character varying(80) DEFAULT 'billing_enabled'::character varying NOT NULL,
    requested_action character varying(80) DEFAULT 'generate_draft_invoice'::character varying NOT NULL,
    payload_json text DEFAULT '{}'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer,
    next_attempt_at timestamp without time zone,
    claimed_at timestamp without time zone,
    claimed_by character varying(128),
    completed_at timestamp without time zone,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: patient_billing_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_billing_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_billing_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_billing_jobs_id_seq OWNED BY public.patient_billing_jobs.id;

--
-- Name: patient_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_cases (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id integer NOT NULL,
    case_number character varying(120) DEFAULT ''::character varying NOT NULL,
    status character varying(24) DEFAULT 'open'::character varying NOT NULL,
    case_type character varying(24) DEFAULT 'budget'::character varying NOT NULL,
    total_allocation numeric(14,2) DEFAULT 0 NOT NULL,
    practitioner character varying(255),
    issue_date date,
    expiry_date date,
    disable_exceeding boolean DEFAULT false NOT NULL,
    referral_contact character varying(255),
    referral_issue_date date,
    referral_period character varying(120),
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    external_id character varying(120),
    external_source character varying(64),
    external_patient_id character varying(120)
);

--
-- Name: patient_cases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_cases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_cases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_cases_id_seq OWNED BY public.patient_cases.id;

--
-- Name: patient_equipment_sourcer_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_equipment_sourcer_jobs (
    id bigint NOT NULL,
    status character varying(32) DEFAULT 'queued'::character varying NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    event_type character varying(80) DEFAULT 'equipment_sourcer_enabled'::character varying NOT NULL,
    requested_action character varying(80) DEFAULT 'source_equipment_suggestions'::character varying NOT NULL,
    payload_json text DEFAULT '{}'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer,
    next_attempt_at timestamp without time zone,
    claimed_at timestamp without time zone,
    claimed_by character varying(128),
    completed_at timestamp without time zone,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: patient_equipment_sourcer_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_equipment_sourcer_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_equipment_sourcer_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_equipment_sourcer_jobs_id_seq OWNED BY public.patient_equipment_sourcer_jobs.id;

--
-- Name: patient_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_files (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id integer,
    file_name character varying(500) NOT NULL,
    mime_type character varying(255) DEFAULT 'application/octet-stream'::character varying NOT NULL,
    file_size bigint NOT NULL,
    file_data bytea,
    storage_backend character varying(20) DEFAULT 'database'::character varying NOT NULL,
    storage_key text,
    created_at timestamp with time zone DEFAULT now(),
    analysis_evidence boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.patient_files FORCE ROW LEVEL SECURITY;

--
-- Name: patient_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_files_id_seq OWNED BY public.patient_files.id;

--
-- Name: patient_quote_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_quote_jobs (
    id bigint NOT NULL,
    status character varying(32) DEFAULT 'queued'::character varying NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    quote_id bigint,
    event_type character varying(80) DEFAULT 'quote_writer_enabled'::character varying NOT NULL,
    requested_action character varying(80) DEFAULT 'draft_patient_quote'::character varying NOT NULL,
    payload_json text DEFAULT '{}'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer,
    next_attempt_at timestamp without time zone,
    claimed_at timestamp without time zone,
    claimed_by character varying(128),
    completed_at timestamp without time zone,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: patient_quote_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_quote_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_quote_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_quote_jobs_id_seq OWNED BY public.patient_quote_jobs.id;

--
-- Name: patient_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_quotes (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id integer NOT NULL,
    quote_number character varying(120) DEFAULT ''::character varying NOT NULL,
    status character varying(24) DEFAULT 'draft'::character varying NOT NULL,
    funding_type character varying(24) DEFAULT 'ndis'::character varying NOT NULL,
    pricing_region character varying(24) DEFAULT 'national'::character varying NOT NULL,
    plan_manager character varying(255),
    ndis_number character varying(64),
    quote_date date,
    valid_until date,
    prepared_by character varying(255),
    gst_applicable boolean DEFAULT false NOT NULL,
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    external_id character varying(120),
    external_source character varying(64),
    external_patient_id character varying(120)
);

--
-- Name: patient_quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_quotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_quotes_id_seq OWNED BY public.patient_quotes.id;

--
-- Name: patient_report_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_report_jobs (
    id bigint NOT NULL,
    status character varying(32) DEFAULT 'queued'::character varying NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    event_type character varying(80) DEFAULT 'reporting_enabled'::character varying NOT NULL,
    requested_action character varying(80) DEFAULT 'create_or_edit'::character varying NOT NULL,
    payload_json text DEFAULT '{}'::text NOT NULL,
    usage_model character varying(120),
    usage_input_tokens bigint,
    usage_output_tokens bigint,
    usage_total_tokens bigint,
    usage_estimated_cost_usd double precision,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer,
    next_attempt_at timestamp without time zone,
    claimed_at timestamp without time zone,
    claimed_by character varying(128),
    completed_at timestamp without time zone,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reviewed_at timestamp without time zone,
    reviewed_by character varying(128)
);

--
-- Name: patient_report_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_report_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_report_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_report_jobs_id_seq OWNED BY public.patient_report_jobs.id;

--
-- Name: patient_service_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_service_agreements (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id integer NOT NULL,
    agreement_number character varying(120) DEFAULT ''::character varying NOT NULL,
    status character varying(24) DEFAULT 'draft'::character varying NOT NULL,
    funding_type character varying(24) DEFAULT 'ndis'::character varying NOT NULL,
    plan_management_type character varying(24) DEFAULT 'unknown'::character varying NOT NULL,
    plan_manager character varying(255),
    ndis_number character varying(64),
    plan_start date,
    plan_end date,
    start_date date,
    end_date date,
    review_date date,
    prepared_by character varying(255),
    cancellation_notice_days integer DEFAULT 2 NOT NULL,
    cancellation_policy text,
    telehealth_authorised boolean DEFAULT false NOT NULL,
    non_face_to_face_authorised boolean DEFAULT false NOT NULL,
    travel_claimable boolean DEFAULT false NOT NULL,
    terms text,
    source_quote_id integer,
    version integer DEFAULT 1 NOT NULL,
    supersedes_agreement_id integer,
    participant_signatory_name character varying(255),
    participant_signed_at timestamp with time zone,
    representative_name character varying(255),
    representative_relationship character varying(120),
    representative_signed_at timestamp with time zone,
    provider_signatory_name character varying(255),
    provider_signed_at timestamp with time zone,
    terminated_at timestamp with time zone,
    termination_reason text,
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    external_id character varying(120),
    external_source character varying(64),
    external_patient_id character varying(120)
);

--
-- Name: patient_service_agreements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_service_agreements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_service_agreements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_service_agreements_id_seq OWNED BY public.patient_service_agreements.id;

--
-- Name: patient_transcript_scribe_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_transcript_scribe_jobs (
    id bigint NOT NULL,
    status character varying(32) DEFAULT 'queued'::character varying NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id bigint NOT NULL,
    patient_name text,
    transcription_id bigint,
    event_type character varying(80) DEFAULT 'transcript_completed'::character varying NOT NULL,
    requested_action character varying(80) DEFAULT 'summarize_transcript'::character varying NOT NULL,
    payload_json text DEFAULT '{}'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer,
    next_attempt_at timestamp without time zone,
    claimed_at timestamp without time zone,
    claimed_by character varying(128),
    completed_at timestamp without time zone,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: patient_transcript_scribe_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_transcript_scribe_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_transcript_scribe_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_transcript_scribe_jobs_id_seq OWNED BY public.patient_transcript_scribe_jobs.id;

--
-- Name: patient_transcriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_transcriptions (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id integer NOT NULL,
    status character varying(50) DEFAULT 'recording'::character varying NOT NULL,
    source character varying(100) DEFAULT 'browser-live'::character varying NOT NULL,
    title character varying(255),
    meeting_external_id character varying(255),
    audio_mime_type character varying(100),
    audio_seconds numeric,
    transcript_text text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: patient_transcriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patient_transcriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patient_transcriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patient_transcriptions_id_seq OWNED BY public.patient_transcriptions.id;

--
-- Name: patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patients (
    id integer NOT NULL,
    patient_name character varying(255) NOT NULL,
    domain character varying(100) NOT NULL,
    metadata jsonb,
    external_id character varying(120),
    external_source character varying(64),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: patients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: patients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patients_id_seq OWNED BY public.patients.id;

--
-- Name: practice_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_locations (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    location_type character varying(24) DEFAULT 'clinic'::character varying NOT NULL,
    address_line1 character varying(255),
    address_line2 character varying(255),
    suburb character varying(120),
    state character varying(32),
    postcode character varying(16),
    country character varying(64) DEFAULT 'Australia'::character varying NOT NULL,
    latitude numeric(9,6),
    longitude numeric(9,6),
    timezone character varying(100) DEFAULT 'Australia/Sydney'::character varying NOT NULL,
    travel_fee_rule character varying(32) DEFAULT 'none'::character varying NOT NULL,
    active boolean DEFAULT true NOT NULL,
    external_id character varying(120),
    external_source character varying(64),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: practice_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.practice_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: practice_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.practice_locations_id_seq OWNED BY public.practice_locations.id;

--
-- Name: practitioner_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practitioner_services (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    practitioner_id integer NOT NULL,
    service_id integer NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: practitioner_services_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.practitioner_services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: practitioner_services_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.practitioner_services_id_seq OWNED BY public.practitioner_services.id;

--
-- Name: practitioners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practitioners (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    admin_user_id integer,
    display_name character varying(255) NOT NULL,
    email character varying(255),
    discipline character varying(120),
    provider_number character varying(64),
    timezone character varying(100) DEFAULT 'Australia/Sydney'::character varying NOT NULL,
    default_location_id integer,
    colour character varying(16),
    active boolean DEFAULT true NOT NULL,
    external_id character varying(120),
    external_source character varying(64),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: practitioners_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.practitioners_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: practitioners_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.practitioners_id_seq OWNED BY public.practitioners.id;

--
-- Name: quote_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_items (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    quote_id integer NOT NULL,
    patient_id integer NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ndis_support_item_number character varying(48),
    ndis_support_item_name character varying(255),
    registration_group_number character varying(16),
    registration_group_name character varying(160),
    support_category_number character varying(16),
    support_category_name character varying(160),
    unit character varying(16),
    quantity numeric(12,2) DEFAULT 1 NOT NULL,
    unit_price numeric(14,2) DEFAULT 0 NOT NULL,
    price_limit numeric(14,2),
    quote_required boolean DEFAULT false NOT NULL,
    description text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: quote_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quote_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: quote_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quote_items_id_seq OWNED BY public.quote_items.id;

--
-- Name: report_domain_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_domain_settings (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    settings_json text DEFAULT '{}'::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: report_domain_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_domain_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: report_domain_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_domain_settings_id_seq OWNED BY public.report_domain_settings.id;

--
-- Name: report_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_templates (
    id bigint NOT NULL,
    domain character varying(100) NOT NULL,
    template_id character varying(191) NOT NULL,
    name character varying(255) NOT NULL,
    file_name character varying(255) NOT NULL,
    mime_type character varying(150) NOT NULL,
    size_bytes bigint DEFAULT 0 NOT NULL,
    content_base64 text NOT NULL,
    uploaded_at timestamp without time zone,
    metadata_json text DEFAULT '{}'::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: report_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: report_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_templates_id_seq OWNED BY public.report_templates.id;

--
-- Name: service_agreement_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_agreement_items (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    agreement_id integer NOT NULL,
    patient_id integer NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ndis_support_item_number character varying(48),
    ndis_support_item_name character varying(255),
    registration_group_number character varying(16),
    registration_group_name character varying(160),
    support_category_number character varying(16),
    support_category_name character varying(160),
    unit character varying(16),
    quantity numeric(12,2) DEFAULT 1 NOT NULL,
    unit_price numeric(14,2) DEFAULT 0 NOT NULL,
    price_limit numeric(14,2),
    quote_required boolean DEFAULT false NOT NULL,
    description text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: service_agreement_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_agreement_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: service_agreement_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_agreement_items_id_seq OWNED BY public.service_agreement_items.id;

--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(64),
    duration_minutes integer DEFAULT 60 NOT NULL,
    buffer_before_minutes integer DEFAULT 0 NOT NULL,
    buffer_after_minutes integer DEFAULT 0 NOT NULL,
    price numeric(12,2),
    gst_applicable boolean DEFAULT true NOT NULL,
    funding_types jsonb DEFAULT '[]'::jsonb NOT NULL,
    ndis_support_item_number character varying(48),
    ndis_support_item_name character varying(255),
    telehealth_allowed boolean DEFAULT true NOT NULL,
    mobile_allowed boolean DEFAULT true NOT NULL,
    colour character varying(16),
    active boolean DEFAULT true NOT NULL,
    external_id character varying(120),
    external_source character varying(64),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT services_duration_positive CHECK ((duration_minutes > 0))
);

--
-- Name: services_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: services_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.services_id_seq OWNED BY public.services.id;

--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key character varying(255) NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: task_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_entries (
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

--
-- Name: task_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: task_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_entries_id_seq OWNED BY public.task_entries.id;

--
-- Name: user_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_credentials (
    user_id uuid NOT NULL,
    password_hash text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: user_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_emails (
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

--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    domain character varying(100) NOT NULL,
    username character varying(100) NOT NULL,
    key character varying(255) NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: user_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    purpose character varying(32) NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name character varying(255),
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: waitlist_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist_entries (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    patient_id integer,
    patient_name character varying(255) NOT NULL,
    service_id integer,
    practitioner_id integer,
    location_id integer,
    priority integer DEFAULT 0 NOT NULL,
    earliest_date date,
    latest_date date,
    status character varying(24) DEFAULT 'waiting'::character varying NOT NULL,
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: waitlist_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.waitlist_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: waitlist_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.waitlist_entries_id_seq OWNED BY public.waitlist_entries.id;

--
-- Name: waitlist_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist_offers (
    id integer NOT NULL,
    domain character varying(100) NOT NULL,
    waitlist_entry_id integer NOT NULL,
    appointment_id integer,
    token character varying(160) NOT NULL,
    status character varying(24) DEFAULT 'offered'::character varying NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    practitioner_id integer,
    service_id integer,
    location_id integer,
    channel character varying(16),
    expires_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    responded_at timestamp with time zone,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT waitlist_offers_time_order CHECK ((ends_at > starts_at))
);

--
-- Name: waitlist_offers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.waitlist_offers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: waitlist_offers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.waitlist_offers_id_seq OWNED BY public.waitlist_offers.id;

--
-- Name: activities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities ALTER COLUMN id SET DEFAULT nextval('public.activities_id_seq'::regclass);

--
-- Name: admin_suppressed_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_suppressed_notifications ALTER COLUMN id SET DEFAULT nextval('public.admin_suppressed_notifications_id_seq'::regclass);

--
-- Name: appointment_reminders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_reminders ALTER COLUMN id SET DEFAULT nextval('public.appointment_reminders_id_seq'::regclass);

--
-- Name: appointments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments ALTER COLUMN id SET DEFAULT nextval('public.appointments_id_seq'::regclass);

--
-- Name: availability_exceptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_exceptions ALTER COLUMN id SET DEFAULT nextval('public.availability_exceptions_id_seq'::regclass);

--
-- Name: availability_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_rules ALTER COLUMN id SET DEFAULT nextval('public.availability_rules_id_seq'::regclass);

--
-- Name: billing id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing ALTER COLUMN id SET DEFAULT nextval('public.billing_id_seq'::regclass);

--
-- Name: calendar_busy_blocks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_busy_blocks ALTER COLUMN id SET DEFAULT nextval('public.calendar_busy_blocks_id_seq'::regclass);

--
-- Name: calendar_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections ALTER COLUMN id SET DEFAULT nextval('public.calendar_connections_id_seq'::regclass);

--
-- Name: case_usage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_usage ALTER COLUMN id SET DEFAULT nextval('public.case_usage_id_seq'::regclass);

--
-- Name: chats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats ALTER COLUMN id SET DEFAULT nextval('public.chats_id_seq'::regclass);

--
-- Name: contact_patients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_patients ALTER COLUMN id SET DEFAULT nextval('public.contact_patients_id_seq'::regclass);

--
-- Name: contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts ALTER COLUMN id SET DEFAULT nextval('public.contacts_id_seq'::regclass);

--
-- Name: content id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content ALTER COLUMN id SET DEFAULT nextval('public.content_id_seq'::regclass);

--
-- Name: content_relationships id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_relationships ALTER COLUMN id SET DEFAULT nextval('public.content_relationships_id_seq'::regclass);

--
-- Name: forms id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms ALTER COLUMN id SET DEFAULT nextval('public.forms_id_seq'::regclass);

--
-- Name: funder_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_documents ALTER COLUMN id SET DEFAULT nextval('public.funder_documents_id_seq'::regclass);

--
-- Name: funders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funders ALTER COLUMN id SET DEFAULT nextval('public.funders_id_seq'::regclass);

--
-- Name: inbound_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_messages ALTER COLUMN id SET DEFAULT nextval('public.inbound_messages_id_seq'::regclass);

--
-- Name: notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes ALTER COLUMN id SET DEFAULT nextval('public.notes_id_seq'::regclass);

--
-- Name: outbound_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_messages ALTER COLUMN id SET DEFAULT nextval('public.outbound_messages_id_seq'::regclass);

--
-- Name: patient_analysis_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_analysis_jobs ALTER COLUMN id SET DEFAULT nextval('public.patient_analysis_jobs_id_seq'::regclass);

--
-- Name: patient_billing_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_billing_jobs ALTER COLUMN id SET DEFAULT nextval('public.patient_billing_jobs_id_seq'::regclass);

--
-- Name: patient_cases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_cases ALTER COLUMN id SET DEFAULT nextval('public.patient_cases_id_seq'::regclass);

--
-- Name: patient_equipment_sourcer_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_equipment_sourcer_jobs ALTER COLUMN id SET DEFAULT nextval('public.patient_equipment_sourcer_jobs_id_seq'::regclass);

--
-- Name: patient_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_files ALTER COLUMN id SET DEFAULT nextval('public.patient_files_id_seq'::regclass);

--
-- Name: patient_quote_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_quote_jobs ALTER COLUMN id SET DEFAULT nextval('public.patient_quote_jobs_id_seq'::regclass);

--
-- Name: patient_quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_quotes ALTER COLUMN id SET DEFAULT nextval('public.patient_quotes_id_seq'::regclass);

--
-- Name: patient_report_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_report_jobs ALTER COLUMN id SET DEFAULT nextval('public.patient_report_jobs_id_seq'::regclass);

--
-- Name: patient_service_agreements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_service_agreements ALTER COLUMN id SET DEFAULT nextval('public.patient_service_agreements_id_seq'::regclass);

--
-- Name: patient_transcript_scribe_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_transcript_scribe_jobs ALTER COLUMN id SET DEFAULT nextval('public.patient_transcript_scribe_jobs_id_seq'::regclass);

--
-- Name: patient_transcriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_transcriptions ALTER COLUMN id SET DEFAULT nextval('public.patient_transcriptions_id_seq'::regclass);

--
-- Name: patients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients ALTER COLUMN id SET DEFAULT nextval('public.patients_id_seq'::regclass);

--
-- Name: practice_locations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_locations ALTER COLUMN id SET DEFAULT nextval('public.practice_locations_id_seq'::regclass);

--
-- Name: practitioner_services id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioner_services ALTER COLUMN id SET DEFAULT nextval('public.practitioner_services_id_seq'::regclass);

--
-- Name: practitioners id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioners ALTER COLUMN id SET DEFAULT nextval('public.practitioners_id_seq'::regclass);

--
-- Name: quote_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_items ALTER COLUMN id SET DEFAULT nextval('public.quote_items_id_seq'::regclass);

--
-- Name: report_domain_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_domain_settings ALTER COLUMN id SET DEFAULT nextval('public.report_domain_settings_id_seq'::regclass);

--
-- Name: report_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_templates ALTER COLUMN id SET DEFAULT nextval('public.report_templates_id_seq'::regclass);

--
-- Name: service_agreement_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreement_items ALTER COLUMN id SET DEFAULT nextval('public.service_agreement_items_id_seq'::regclass);

--
-- Name: services id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services ALTER COLUMN id SET DEFAULT nextval('public.services_id_seq'::regclass);

--
-- Name: task_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_entries ALTER COLUMN id SET DEFAULT nextval('public.task_entries_id_seq'::regclass);

--
-- Name: waitlist_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_entries ALTER COLUMN id SET DEFAULT nextval('public.waitlist_entries_id_seq'::regclass);

--
-- Name: waitlist_offers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_offers ALTER COLUMN id SET DEFAULT nextval('public.waitlist_offers_id_seq'::regclass);

--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);

--
-- Name: admin_suppressed_notifications admin_suppressed_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_suppressed_notifications
    ADD CONSTRAINT admin_suppressed_notifications_pkey PRIMARY KEY (id);

--
-- Name: api_rate_limits api_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_rate_limits
    ADD CONSTRAINT api_rate_limits_pkey PRIMARY KEY (bucket_key);

--
-- Name: appointment_reminders appointment_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_reminders
    ADD CONSTRAINT appointment_reminders_pkey PRIMARY KEY (id);

--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);

--
-- Name: auth_identities auth_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_identities
    ADD CONSTRAINT auth_identities_pkey PRIMARY KEY (id);

--
-- Name: auth_identities auth_identities_provider_provider_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_identities
    ADD CONSTRAINT auth_identities_provider_provider_account_id_key UNIQUE (provider, provider_account_id);

--
-- Name: availability_exceptions availability_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_exceptions
    ADD CONSTRAINT availability_exceptions_pkey PRIMARY KEY (id);

--
-- Name: availability_rules availability_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_rules
    ADD CONSTRAINT availability_rules_pkey PRIMARY KEY (id);

--
-- Name: billing billing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing
    ADD CONSTRAINT billing_pkey PRIMARY KEY (id);

--
-- Name: calendar_busy_blocks calendar_busy_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_busy_blocks
    ADD CONSTRAINT calendar_busy_blocks_pkey PRIMARY KEY (id);

--
-- Name: calendar_connections calendar_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_pkey PRIMARY KEY (id);

--
-- Name: case_usage case_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_usage
    ADD CONSTRAINT case_usage_pkey PRIMARY KEY (id);

--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);

--
-- Name: contact_patients contact_patients_contact_id_patient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_patients
    ADD CONSTRAINT contact_patients_contact_id_patient_id_key UNIQUE (contact_id, patient_id);

--
-- Name: contact_patients contact_patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_patients
    ADD CONSTRAINT contact_patients_pkey PRIMARY KEY (id);

--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);

--
-- Name: content content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content
    ADD CONSTRAINT content_pkey PRIMARY KEY (id);

--
-- Name: content_relationships content_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_relationships
    ADD CONSTRAINT content_relationships_pkey PRIMARY KEY (id);

--
-- Name: content_relationships content_relationships_source_id_target_id_relationship_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_relationships
    ADD CONSTRAINT content_relationships_source_id_target_id_relationship_type_key UNIQUE (source_id, target_id, relationship_type);

--
-- Name: content content_type_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content
    ADD CONSTRAINT content_type_slug_key UNIQUE (type, slug);

--
-- Name: domain_settings domain_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_settings
    ADD CONSTRAINT domain_settings_pkey PRIMARY KEY (domain, key);

--
-- Name: forms forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_pkey PRIMARY KEY (id);

--
-- Name: funder_documents funder_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_documents
    ADD CONSTRAINT funder_documents_pkey PRIMARY KEY (id);

--
-- Name: funders funders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funders
    ADD CONSTRAINT funders_pkey PRIMARY KEY (id);

--
-- Name: inbound_messages inbound_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_messages
    ADD CONSTRAINT inbound_messages_pkey PRIMARY KEY (id);

--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);

--
-- Name: outbound_messages outbound_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_messages
    ADD CONSTRAINT outbound_messages_pkey PRIMARY KEY (id);

--
-- Name: patient_analysis_jobs patient_analysis_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_analysis_jobs
    ADD CONSTRAINT patient_analysis_jobs_pkey PRIMARY KEY (id);

--
-- Name: patient_billing_jobs patient_billing_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_billing_jobs
    ADD CONSTRAINT patient_billing_jobs_pkey PRIMARY KEY (id);

--
-- Name: patient_cases patient_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_cases
    ADD CONSTRAINT patient_cases_pkey PRIMARY KEY (id);

--
-- Name: patient_equipment_sourcer_jobs patient_equipment_sourcer_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_equipment_sourcer_jobs
    ADD CONSTRAINT patient_equipment_sourcer_jobs_pkey PRIMARY KEY (id);

--
-- Name: patient_files patient_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_files
    ADD CONSTRAINT patient_files_pkey PRIMARY KEY (id);

--
-- Name: patient_quote_jobs patient_quote_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_quote_jobs
    ADD CONSTRAINT patient_quote_jobs_pkey PRIMARY KEY (id);

--
-- Name: patient_quotes patient_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_quotes
    ADD CONSTRAINT patient_quotes_pkey PRIMARY KEY (id);

--
-- Name: patient_report_jobs patient_report_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_report_jobs
    ADD CONSTRAINT patient_report_jobs_pkey PRIMARY KEY (id);

--
-- Name: patient_service_agreements patient_service_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_service_agreements
    ADD CONSTRAINT patient_service_agreements_pkey PRIMARY KEY (id);

--
-- Name: patient_transcript_scribe_jobs patient_transcript_scribe_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_transcript_scribe_jobs
    ADD CONSTRAINT patient_transcript_scribe_jobs_pkey PRIMARY KEY (id);

--
-- Name: patient_transcriptions patient_transcriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_transcriptions
    ADD CONSTRAINT patient_transcriptions_pkey PRIMARY KEY (id);

--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);

--
-- Name: practice_locations practice_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_locations
    ADD CONSTRAINT practice_locations_pkey PRIMARY KEY (id);

--
-- Name: practitioner_services practitioner_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioner_services
    ADD CONSTRAINT practitioner_services_pkey PRIMARY KEY (id);

--
-- Name: practitioners practitioners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioners
    ADD CONSTRAINT practitioners_pkey PRIMARY KEY (id);

--
-- Name: quote_items quote_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_pkey PRIMARY KEY (id);

--
-- Name: report_domain_settings report_domain_settings_domain_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_domain_settings
    ADD CONSTRAINT report_domain_settings_domain_unique UNIQUE (domain);

--
-- Name: report_domain_settings report_domain_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_domain_settings
    ADD CONSTRAINT report_domain_settings_pkey PRIMARY KEY (id);

--
-- Name: report_templates report_templates_domain_template_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_domain_template_unique UNIQUE (domain, template_id);

--
-- Name: report_templates report_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_pkey PRIMARY KEY (id);

--
-- Name: service_agreement_items service_agreement_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_agreement_items
    ADD CONSTRAINT service_agreement_items_pkey PRIMARY KEY (id);

--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);

--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);

--
-- Name: task_entries task_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_entries
    ADD CONSTRAINT task_entries_pkey PRIMARY KEY (id);

--
-- Name: user_credentials user_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_pkey PRIMARY KEY (user_id);

--
-- Name: user_emails user_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_emails
    ADD CONSTRAINT user_emails_pkey PRIMARY KEY (id);

--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (domain, username, key);

--
-- Name: user_tokens user_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tokens
    ADD CONSTRAINT user_tokens_pkey PRIMARY KEY (id);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: waitlist_entries waitlist_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_entries
    ADD CONSTRAINT waitlist_entries_pkey PRIMARY KEY (id);

--
-- Name: waitlist_offers waitlist_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_offers
    ADD CONSTRAINT waitlist_offers_pkey PRIMARY KEY (id);

--
-- Name: activities_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_actor_idx ON public.activities USING btree (actor_type, actor_id);

--
-- Name: activities_domain_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_domain_created_idx ON public.activities USING btree (domain, created_at DESC);

--
-- Name: activities_domain_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_domain_entity_idx ON public.activities USING btree (domain, entity_type, entity_id);

--
-- Name: activities_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_domain_idx ON public.activities USING btree (domain);

--
-- Name: activities_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_domain_patient_idx ON public.activities USING btree (domain, patient_id);

--
-- Name: activities_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_entity_idx ON public.activities USING btree (entity_type, entity_id);

--
-- Name: admin_suppressed_notifications_domain_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_suppressed_notifications_domain_created_idx ON public.admin_suppressed_notifications USING btree (domain, created_at);

--
-- Name: appointment_reminders_domain_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_reminders_domain_appointment_idx ON public.appointment_reminders USING btree (domain, appointment_id);

--
-- Name: appointment_reminders_domain_appointment_offset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointment_reminders_domain_appointment_offset_idx ON public.appointment_reminders USING btree (domain, appointment_id, offset_hours);

--
-- Name: appointment_reminders_domain_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_reminders_domain_due_idx ON public.appointment_reminders USING btree (domain, status, scheduled_for);

--
-- Name: appointments_domain_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_case_idx ON public.appointments USING btree (domain, case_id);

--
-- Name: appointments_domain_confirmation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_confirmation_idx ON public.appointments USING btree (domain, confirmation_status);

--
-- Name: appointments_domain_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_external_idx ON public.appointments USING btree (domain, external_id);

--
-- Name: appointments_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_idx ON public.appointments USING btree (domain);

--
-- Name: appointments_domain_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_location_idx ON public.appointments USING btree (domain, location_id);

--
-- Name: appointments_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_patient_idx ON public.appointments USING btree (domain, patient_id);

--
-- Name: appointments_domain_practitioner_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_practitioner_start_idx ON public.appointments USING btree (domain, practitioner_id, starts_at);

--
-- Name: appointments_domain_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_service_idx ON public.appointments USING btree (domain, service_id);

--
-- Name: appointments_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointments_domain_source_external_idx ON public.appointments USING btree (domain, external_source, external_id);

--
-- Name: appointments_domain_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_start_idx ON public.appointments USING btree (domain, starts_at);

--
-- Name: appointments_domain_status_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_domain_status_start_idx ON public.appointments USING btree (domain, appointment_status, starts_at);

--
-- Name: auth_identities_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_identities_user_idx ON public.auth_identities USING btree (user_id);

--
-- Name: availability_exceptions_domain_practitioner_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX availability_exceptions_domain_practitioner_start_idx ON public.availability_exceptions USING btree (domain, practitioner_id, starts_at);

--
-- Name: availability_rules_domain_practitioner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX availability_rules_domain_practitioner_idx ON public.availability_rules USING btree (domain, practitioner_id);

--
-- Name: availability_rules_domain_weekday_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX availability_rules_domain_weekday_idx ON public.availability_rules USING btree (domain, practitioner_id, weekday);

--
-- Name: billing_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_account_idx ON public.billing USING btree (account_id);

--
-- Name: billing_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_domain_idx ON public.billing USING btree (domain);

--
-- Name: calendar_busy_blocks_connection_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_busy_blocks_connection_start_idx ON public.calendar_busy_blocks USING btree (connection_id, starts_at);

--
-- Name: calendar_busy_blocks_domain_practitioner_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_busy_blocks_domain_practitioner_start_idx ON public.calendar_busy_blocks USING btree (domain, practitioner_id, starts_at);

--
-- Name: calendar_connections_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_connections_domain_idx ON public.calendar_connections USING btree (domain);

--
-- Name: calendar_connections_domain_practitioner_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX calendar_connections_domain_practitioner_provider_idx ON public.calendar_connections USING btree (domain, practitioner_id, provider);

--
-- Name: case_usage_case_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX case_usage_case_id_idx ON public.case_usage USING btree (case_id);

--
-- Name: case_usage_domain_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX case_usage_domain_case_idx ON public.case_usage USING btree (domain, case_id);

--
-- Name: contact_patients_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_patients_contact_idx ON public.contact_patients USING btree (contact_id);

--
-- Name: contact_patients_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_patients_domain_patient_idx ON public.contact_patients USING btree (domain, patient_id);

--
-- Name: contacts_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_domain_idx ON public.contacts USING btree (domain);

--
-- Name: contacts_domain_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_domain_name_idx ON public.contacts USING btree (domain, lower((name)::text));

--
-- Name: contacts_domain_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_domain_updated_idx ON public.contacts USING btree (domain, updated_at);

--
-- Name: content_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_domain_idx ON public.content USING btree (domain);

--
-- Name: content_domain_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_domain_status_idx ON public.content USING btree (domain, status);

--
-- Name: content_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_published_at_idx ON public.content USING btree (published_at);

--
-- Name: content_rel_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_rel_source_idx ON public.content_relationships USING btree (source_id);

--
-- Name: content_rel_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_rel_target_idx ON public.content_relationships USING btree (target_id);

--
-- Name: content_rel_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_rel_type_idx ON public.content_relationships USING btree (relationship_type);

--
-- Name: content_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_slug_idx ON public.content USING btree (slug);

--
-- Name: content_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_status_idx ON public.content USING btree (status);

--
-- Name: content_subtype_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_subtype_idx ON public.content USING btree (subtype);

--
-- Name: content_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_type_idx ON public.content USING btree (type);

--
-- Name: domain_settings_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX domain_settings_key_idx ON public.domain_settings USING btree (key);

--
-- Name: forms_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forms_domain_idx ON public.forms USING btree (domain);

--
-- Name: forms_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forms_domain_patient_idx ON public.forms USING btree (domain, patient_id);

--
-- Name: forms_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX forms_domain_source_external_idx ON public.forms USING btree (domain, external_source, external_id);

--
-- Name: forms_domain_submitted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forms_domain_submitted_idx ON public.forms USING btree (domain, submitted_at);

--
-- Name: funder_documents_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX funder_documents_category_idx ON public.funder_documents USING btree (category);

--
-- Name: funder_documents_funder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX funder_documents_funder_idx ON public.funder_documents USING btree (funder_id);

--
-- Name: funder_documents_funder_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX funder_documents_funder_key_idx ON public.funder_documents USING btree (funder_id, key) WHERE ((key)::text <> ''::text);

--
-- Name: funders_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX funders_key_idx ON public.funders USING btree (key);

--
-- Name: funders_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX funders_status_idx ON public.funders USING btree (status);

--
-- Name: idx_chats_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_created_at ON public.chats USING btree (created_at);

--
-- Name: idx_chats_domain_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_domain_role ON public.chats USING btree (domain, role);

--
-- Name: idx_chats_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_session_id ON public.chats USING btree (session_id);

--
-- Name: inbound_messages_claimed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbound_messages_claimed_at_idx ON public.inbound_messages USING btree (claimed_at);

--
-- Name: inbound_messages_domain_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbound_messages_domain_created_idx ON public.inbound_messages USING btree (domain, created_at);

--
-- Name: inbound_messages_provider_msg_id_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbound_messages_provider_msg_id_uidx ON public.inbound_messages USING btree (provider, provider_message_id) WHERE (provider_message_id IS NOT NULL);

--
-- Name: inbound_messages_status_next_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbound_messages_status_next_attempt_idx ON public.inbound_messages USING btree (status, next_attempt_at);

--
-- Name: notes_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notes_domain_idx ON public.notes USING btree (domain);

--
-- Name: notes_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notes_domain_patient_idx ON public.notes USING btree (domain, patient_id);

--
-- Name: notes_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notes_domain_source_external_idx ON public.notes USING btree (domain, external_source, external_id);

--
-- Name: notes_domain_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notes_domain_updated_idx ON public.notes USING btree (domain, updated_at);

--
-- Name: patient_analysis_jobs_domain_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_analysis_jobs_domain_created_idx ON public.patient_analysis_jobs USING btree (domain, created_at);

--
-- Name: patient_analysis_jobs_status_next_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_analysis_jobs_status_next_attempt_idx ON public.patient_analysis_jobs USING btree (status, next_attempt_at);

--
-- Name: patient_billing_jobs_domain_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_billing_jobs_domain_created_idx ON public.patient_billing_jobs USING btree (domain, created_at);

--
-- Name: patient_billing_jobs_status_next_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_billing_jobs_status_next_attempt_idx ON public.patient_billing_jobs USING btree (status, next_attempt_at);

--
-- Name: patient_cases_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_cases_domain_idx ON public.patient_cases USING btree (domain);

--
-- Name: patient_cases_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_cases_domain_patient_idx ON public.patient_cases USING btree (domain, patient_id);

--
-- Name: patient_cases_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX patient_cases_domain_source_external_idx ON public.patient_cases USING btree (domain, external_source, external_id);

--
-- Name: patient_cases_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_cases_status_idx ON public.patient_cases USING btree (status);

--
-- Name: patient_equipment_sourcer_jobs_domain_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_equipment_sourcer_jobs_domain_created_idx ON public.patient_equipment_sourcer_jobs USING btree (domain, created_at);

--
-- Name: patient_equipment_sourcer_jobs_status_next_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_equipment_sourcer_jobs_status_next_attempt_idx ON public.patient_equipment_sourcer_jobs USING btree (status, next_attempt_at);

--
-- Name: patient_files_domain_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_files_domain_created_idx ON public.patient_files USING btree (domain, created_at DESC);

--
-- Name: patient_files_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_files_domain_patient_idx ON public.patient_files USING btree (domain, patient_id);

--
-- Name: patient_quote_jobs_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_quote_jobs_domain_patient_idx ON public.patient_quote_jobs USING btree (domain, patient_id, created_at);

--
-- Name: patient_quote_jobs_status_next_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_quote_jobs_status_next_attempt_idx ON public.patient_quote_jobs USING btree (status, next_attempt_at);

--
-- Name: patient_quotes_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_quotes_domain_idx ON public.patient_quotes USING btree (domain);

--
-- Name: patient_quotes_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_quotes_domain_patient_idx ON public.patient_quotes USING btree (domain, patient_id);

--
-- Name: patient_quotes_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX patient_quotes_domain_source_external_idx ON public.patient_quotes USING btree (domain, external_source, external_id);

--
-- Name: patient_quotes_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_quotes_status_idx ON public.patient_quotes USING btree (status);

--
-- Name: patient_report_jobs_domain_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_report_jobs_domain_created_idx ON public.patient_report_jobs USING btree (domain, created_at);

--
-- Name: patient_report_jobs_status_next_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_report_jobs_status_next_attempt_idx ON public.patient_report_jobs USING btree (status, next_attempt_at);

--
-- Name: patient_service_agreements_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_service_agreements_domain_idx ON public.patient_service_agreements USING btree (domain);

--
-- Name: patient_service_agreements_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_service_agreements_domain_patient_idx ON public.patient_service_agreements USING btree (domain, patient_id);

--
-- Name: patient_service_agreements_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX patient_service_agreements_domain_source_external_idx ON public.patient_service_agreements USING btree (domain, external_source, external_id);

--
-- Name: patient_service_agreements_source_quote_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_service_agreements_source_quote_idx ON public.patient_service_agreements USING btree (domain, source_quote_id);

--
-- Name: patient_service_agreements_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_service_agreements_status_idx ON public.patient_service_agreements USING btree (status);

--
-- Name: patient_transcript_scribe_jobs_domain_patient_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_transcript_scribe_jobs_domain_patient_created_idx ON public.patient_transcript_scribe_jobs USING btree (domain, patient_id, created_at);

--
-- Name: patient_transcript_scribe_jobs_status_next_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_transcript_scribe_jobs_status_next_attempt_idx ON public.patient_transcript_scribe_jobs USING btree (status, next_attempt_at);

--
-- Name: patient_transcript_scribe_jobs_transcription_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_transcript_scribe_jobs_transcription_idx ON public.patient_transcript_scribe_jobs USING btree (transcription_id);

--
-- Name: patient_transcriptions_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_transcriptions_created_idx ON public.patient_transcriptions USING btree (created_at DESC);

--
-- Name: patient_transcriptions_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_transcriptions_domain_idx ON public.patient_transcriptions USING btree (domain);

--
-- Name: patient_transcriptions_domain_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_transcriptions_domain_patient_idx ON public.patient_transcriptions USING btree (domain, patient_id);

--
-- Name: patient_transcriptions_patient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_transcriptions_patient_idx ON public.patient_transcriptions USING btree (patient_id);

--
-- Name: patients_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patients_domain_idx ON public.patients USING btree (domain);

--
-- Name: patients_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX patients_domain_source_external_idx ON public.patients USING btree (domain, external_source, external_id);

--
-- Name: practice_locations_domain_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_locations_domain_active_idx ON public.practice_locations USING btree (domain, active);

--
-- Name: practice_locations_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_locations_domain_idx ON public.practice_locations USING btree (domain);

--
-- Name: practice_locations_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX practice_locations_domain_source_external_idx ON public.practice_locations USING btree (domain, external_source, external_id);

--
-- Name: practitioner_services_domain_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX practitioner_services_domain_pair_idx ON public.practitioner_services USING btree (domain, practitioner_id, service_id);

--
-- Name: practitioner_services_domain_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practitioner_services_domain_service_idx ON public.practitioner_services USING btree (domain, service_id);

--
-- Name: practitioners_domain_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practitioners_domain_active_idx ON public.practitioners USING btree (domain, active);

--
-- Name: practitioners_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practitioners_domain_idx ON public.practitioners USING btree (domain);

--
-- Name: practitioners_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX practitioners_domain_source_external_idx ON public.practitioners USING btree (domain, external_source, external_id);

--
-- Name: quote_items_domain_quote_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_items_domain_quote_idx ON public.quote_items USING btree (domain, quote_id);

--
-- Name: quote_items_quote_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_items_quote_id_idx ON public.quote_items USING btree (quote_id);

--
-- Name: report_domain_settings_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_domain_settings_updated_idx ON public.report_domain_settings USING btree (updated_at);

--
-- Name: report_templates_domain_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_templates_domain_name_idx ON public.report_templates USING btree (domain, name);

--
-- Name: report_templates_domain_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_templates_domain_updated_idx ON public.report_templates USING btree (domain, updated_at);

--
-- Name: service_agreement_items_agreement_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_agreement_items_agreement_id_idx ON public.service_agreement_items USING btree (agreement_id);

--
-- Name: service_agreement_items_domain_agreement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_agreement_items_domain_agreement_idx ON public.service_agreement_items USING btree (domain, agreement_id);

--
-- Name: services_domain_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_domain_active_idx ON public.services USING btree (domain, active);

--
-- Name: services_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_domain_idx ON public.services USING btree (domain);

--
-- Name: services_domain_source_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX services_domain_source_external_idx ON public.services USING btree (domain, external_source, external_id);

--
-- Name: task_entries_domain_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX task_entries_domain_item_idx ON public.task_entries USING btree (domain, item_key);

--
-- Name: user_emails_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_emails_user_idx ON public.user_emails USING btree (user_id);

--
-- Name: user_emails_verified_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_emails_verified_address_key ON public.user_emails USING btree (lower(address)) WHERE (verified_at IS NOT NULL);

--
-- Name: user_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_tokens_user_idx ON public.user_tokens USING btree (user_id);

--
-- Name: waitlist_entries_domain_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waitlist_entries_domain_service_idx ON public.waitlist_entries USING btree (domain, service_id);

--
-- Name: waitlist_entries_domain_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waitlist_entries_domain_status_idx ON public.waitlist_entries USING btree (domain, status);

--
-- Name: waitlist_offers_domain_entry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waitlist_offers_domain_entry_idx ON public.waitlist_offers USING btree (domain, waitlist_entry_id);

--
-- Name: waitlist_offers_domain_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waitlist_offers_domain_status_idx ON public.waitlist_offers USING btree (domain, status, expires_at);

--
-- Name: waitlist_offers_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX waitlist_offers_token_idx ON public.waitlist_offers USING btree (token);

--
-- Name: auth_identities auth_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_identities
    ADD CONSTRAINT auth_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: content_relationships content_relationships_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_relationships
    ADD CONSTRAINT content_relationships_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.content(id) ON DELETE CASCADE;

--
-- Name: content_relationships content_relationships_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_relationships
    ADD CONSTRAINT content_relationships_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.content(id) ON DELETE CASCADE;

--
-- Name: user_credentials user_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: user_emails user_emails_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_emails
    ADD CONSTRAINT user_emails_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: user_tokens user_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tokens
    ADD CONSTRAINT user_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: activities activities_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activities_domain_policy ON public.activities TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: admin_suppressed_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_suppressed_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_suppressed_notifications admin_suppressed_notifications_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_suppressed_notifications_domain_policy ON public.admin_suppressed_notifications TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: api_rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: api_rate_limits api_rate_limits_service_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_rate_limits_service_policy ON public.api_rate_limits TO practice_manager_app USING (true) WITH CHECK (true);

--
-- Name: appointment_reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: appointment_reminders appointment_reminders_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointment_reminders_domain_policy ON public.appointment_reminders TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments appointments_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointments_domain_policy ON public.appointments TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: auth_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: availability_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: availability_exceptions availability_exceptions_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY availability_exceptions_domain_policy ON public.availability_exceptions TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: availability_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: availability_rules availability_rules_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY availability_rules_domain_policy ON public.availability_rules TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: billing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing ENABLE ROW LEVEL SECURITY;

--
-- Name: billing billing_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_domain_policy ON public.billing TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: calendar_busy_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_busy_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_busy_blocks calendar_busy_blocks_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_busy_blocks_domain_policy ON public.calendar_busy_blocks TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: calendar_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_connections calendar_connections_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_connections_domain_policy ON public.calendar_connections TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: case_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.case_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: case_usage case_usage_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY case_usage_domain_policy ON public.case_usage TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: chats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

--
-- Name: chats chats_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chats_domain_policy ON public.chats TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: contact_patients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_patients ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_patients contact_patients_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_patients_domain_policy ON public.contact_patients TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts contacts_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_domain_policy ON public.contacts TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: content; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;

--
-- Name: content content_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY content_delete_policy ON public.content FOR DELETE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL)));

--
-- Name: content content_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY content_insert_policy ON public.content FOR INSERT TO practice_manager_app WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL)));

--
-- Name: content content_public_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY content_public_read_policy ON public.content FOR SELECT TO practice_manager_app USING (true);

--
-- Name: content_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: content content_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY content_update_policy ON public.content FOR UPDATE TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)) OR (domain IS NULL)));

--
-- Name: domain_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.domain_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: domain_settings domain_settings_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY domain_settings_domain_policy ON public.domain_settings TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: forms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;

--
-- Name: forms forms_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY forms_domain_policy ON public.forms TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: funder_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funder_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: funder_documents funder_documents_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_documents_delete_policy ON public.funder_documents FOR DELETE TO practice_manager_app USING ((current_setting('app.current_role'::text, true) = 'superadmin'::text));

--
-- Name: funder_documents funder_documents_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_documents_insert_policy ON public.funder_documents FOR INSERT TO practice_manager_app WITH CHECK ((current_setting('app.current_role'::text, true) = 'superadmin'::text));

--
-- Name: funder_documents funder_documents_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_documents_read_policy ON public.funder_documents FOR SELECT TO practice_manager_app USING (true);

--
-- Name: funder_documents funder_documents_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_documents_update_policy ON public.funder_documents FOR UPDATE TO practice_manager_app USING ((current_setting('app.current_role'::text, true) = 'superadmin'::text)) WITH CHECK ((current_setting('app.current_role'::text, true) = 'superadmin'::text));

--
-- Name: funders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funders ENABLE ROW LEVEL SECURITY;

--
-- Name: funders funders_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funders_delete_policy ON public.funders FOR DELETE TO practice_manager_app USING ((current_setting('app.current_role'::text, true) = 'superadmin'::text));

--
-- Name: funders funders_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funders_insert_policy ON public.funders FOR INSERT TO practice_manager_app WITH CHECK ((current_setting('app.current_role'::text, true) = 'superadmin'::text));

--
-- Name: funders funders_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funders_read_policy ON public.funders FOR SELECT TO practice_manager_app USING (true);

--
-- Name: funders funders_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funders_update_policy ON public.funders FOR UPDATE TO practice_manager_app USING ((current_setting('app.current_role'::text, true) = 'superadmin'::text)) WITH CHECK ((current_setting('app.current_role'::text, true) = 'superadmin'::text));

--
-- Name: inbound_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: inbound_messages inbound_messages_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inbound_messages_domain_policy ON public.inbound_messages TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

--
-- Name: notes notes_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notes_domain_policy ON public.notes TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: outbound_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: outbound_messages outbound_messages_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outbound_messages_domain_policy ON public.outbound_messages TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_analysis_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_analysis_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_analysis_jobs patient_analysis_jobs_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_analysis_jobs_domain_policy ON public.patient_analysis_jobs TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_billing_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_billing_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_billing_jobs patient_billing_jobs_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_billing_jobs_domain_policy ON public.patient_billing_jobs TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_cases ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_cases patient_cases_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_cases_domain_policy ON public.patient_cases TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_equipment_sourcer_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_equipment_sourcer_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_equipment_sourcer_jobs patient_equipment_sourcer_jobs_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_equipment_sourcer_jobs_domain_policy ON public.patient_equipment_sourcer_jobs TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_files ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_files patient_files_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_files_domain_policy ON public.patient_files USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_quote_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_quote_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_quote_jobs patient_quote_jobs_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_quote_jobs_domain_policy ON public.patient_quote_jobs TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_quotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_quotes patient_quotes_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_quotes_domain_policy ON public.patient_quotes TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_report_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_report_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_report_jobs patient_report_jobs_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_report_jobs_domain_policy ON public.patient_report_jobs TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_service_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_service_agreements ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_service_agreements patient_service_agreements_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_service_agreements_domain_policy ON public.patient_service_agreements TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_transcript_scribe_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_transcript_scribe_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_transcript_scribe_jobs patient_transcript_scribe_jobs_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_transcript_scribe_jobs_domain_policy ON public.patient_transcript_scribe_jobs TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patient_transcriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_transcriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_transcriptions patient_transcriptions_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patient_transcriptions_domain_policy ON public.patient_transcriptions TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: patients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

--
-- Name: patients patients_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patients_domain_policy ON public.patients TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: practice_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_locations practice_locations_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practice_locations_domain_policy ON public.practice_locations TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: practitioner_services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practitioner_services ENABLE ROW LEVEL SECURITY;

--
-- Name: practitioner_services practitioner_services_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practitioner_services_domain_policy ON public.practitioner_services TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: practitioners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practitioners ENABLE ROW LEVEL SECURITY;

--
-- Name: practitioners practitioners_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practitioners_domain_policy ON public.practitioners TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: quote_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

--
-- Name: quote_items quote_items_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quote_items_domain_policy ON public.quote_items TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: report_domain_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_domain_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: report_domain_settings report_domain_settings_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY report_domain_settings_domain_policy ON public.report_domain_settings TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: report_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: report_templates report_templates_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY report_templates_domain_policy ON public.report_templates TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: service_agreement_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_agreement_items ENABLE ROW LEVEL SECURITY;

--
-- Name: service_agreement_items service_agreement_items_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_agreement_items_domain_policy ON public.service_agreement_items TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: services services_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY services_domain_policy ON public.services TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: system_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: system_settings system_settings_global_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_settings_global_policy ON public.system_settings TO practice_manager_app USING (true) WITH CHECK (true);

--
-- Name: task_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: task_entries task_entries_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_entries_domain_policy ON public.task_entries TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: user_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: user_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings user_settings_user_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_settings_user_policy ON public.user_settings TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (((domain)::text = current_setting('app.current_domain'::text, true)) AND ((username)::text = current_setting('app.current_username'::text, true))))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR (((domain)::text = current_setting('app.current_domain'::text, true)) AND ((username)::text = current_setting('app.current_username'::text, true)))));

--
-- Name: user_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist_entries waitlist_entries_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waitlist_entries_domain_policy ON public.waitlist_entries TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: waitlist_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waitlist_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist_offers waitlist_offers_domain_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waitlist_offers_domain_policy ON public.waitlist_offers TO practice_manager_app USING (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true)))) WITH CHECK (((current_setting('app.current_role'::text, true) = 'superadmin'::text) OR ((domain)::text = current_setting('app.current_domain'::text, true))));

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO practice_manager_app;

--
-- Name: TABLE activities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.activities TO practice_manager_app;

--
-- Name: SEQUENCE activities_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.activities_id_seq TO practice_manager_app;

--
-- Name: TABLE admin_suppressed_notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.admin_suppressed_notifications TO practice_manager_app;

--
-- Name: SEQUENCE admin_suppressed_notifications_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.admin_suppressed_notifications_id_seq TO practice_manager_app;

--
-- Name: TABLE api_rate_limits; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.api_rate_limits TO practice_manager_app;

--
-- Name: TABLE appointment_reminders; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.appointment_reminders TO practice_manager_app;

--
-- Name: SEQUENCE appointment_reminders_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.appointment_reminders_id_seq TO practice_manager_app;

--
-- Name: TABLE appointments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.appointments TO practice_manager_app;

--
-- Name: SEQUENCE appointments_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.appointments_id_seq TO practice_manager_app;

--
-- Name: TABLE availability_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.availability_exceptions TO practice_manager_app;

--
-- Name: SEQUENCE availability_exceptions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.availability_exceptions_id_seq TO practice_manager_app;

--
-- Name: TABLE availability_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.availability_rules TO practice_manager_app;

--
-- Name: SEQUENCE availability_rules_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.availability_rules_id_seq TO practice_manager_app;

--
-- Name: TABLE billing; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.billing TO practice_manager_app;

--
-- Name: SEQUENCE billing_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.billing_id_seq TO practice_manager_app;

--
-- Name: TABLE calendar_busy_blocks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.calendar_busy_blocks TO practice_manager_app;

--
-- Name: SEQUENCE calendar_busy_blocks_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.calendar_busy_blocks_id_seq TO practice_manager_app;

--
-- Name: TABLE calendar_connections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.calendar_connections TO practice_manager_app;

--
-- Name: SEQUENCE calendar_connections_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.calendar_connections_id_seq TO practice_manager_app;

--
-- Name: TABLE case_usage; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.case_usage TO practice_manager_app;

--
-- Name: SEQUENCE case_usage_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.case_usage_id_seq TO practice_manager_app;

--
-- Name: TABLE chats; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chats TO practice_manager_app;

--
-- Name: SEQUENCE chats_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.chats_id_seq TO practice_manager_app;

--
-- Name: TABLE contact_patients; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.contact_patients TO practice_manager_app;

--
-- Name: SEQUENCE contact_patients_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.contact_patients_id_seq TO practice_manager_app;

--
-- Name: TABLE contacts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.contacts TO practice_manager_app;

--
-- Name: SEQUENCE contacts_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.contacts_id_seq TO practice_manager_app;

--
-- Name: TABLE content; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content TO practice_manager_app;

--
-- Name: SEQUENCE content_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.content_id_seq TO practice_manager_app;

--
-- Name: TABLE domain_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.domain_settings TO practice_manager_app;

--
-- Name: TABLE forms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.forms TO practice_manager_app;

--
-- Name: SEQUENCE forms_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.forms_id_seq TO practice_manager_app;

--
-- Name: TABLE funder_documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.funder_documents TO practice_manager_app;

--
-- Name: SEQUENCE funder_documents_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.funder_documents_id_seq TO practice_manager_app;

--
-- Name: TABLE funders; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.funders TO practice_manager_app;

--
-- Name: SEQUENCE funders_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.funders_id_seq TO practice_manager_app;

--
-- Name: TABLE inbound_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.inbound_messages TO practice_manager_app;

--
-- Name: SEQUENCE inbound_messages_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.inbound_messages_id_seq TO practice_manager_app;

--
-- Name: TABLE notes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notes TO practice_manager_app;

--
-- Name: SEQUENCE notes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.notes_id_seq TO practice_manager_app;

--
-- Name: TABLE outbound_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.outbound_messages TO practice_manager_app;

--
-- Name: SEQUENCE outbound_messages_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.outbound_messages_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_analysis_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_analysis_jobs TO practice_manager_app;

--
-- Name: SEQUENCE patient_analysis_jobs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_analysis_jobs_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_billing_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_billing_jobs TO practice_manager_app;

--
-- Name: SEQUENCE patient_billing_jobs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_billing_jobs_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_cases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_cases TO practice_manager_app;

--
-- Name: SEQUENCE patient_cases_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_cases_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_equipment_sourcer_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_equipment_sourcer_jobs TO practice_manager_app;

--
-- Name: SEQUENCE patient_equipment_sourcer_jobs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_equipment_sourcer_jobs_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_quote_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_quote_jobs TO practice_manager_app;

--
-- Name: SEQUENCE patient_quote_jobs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_quote_jobs_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_quotes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_quotes TO practice_manager_app;

--
-- Name: SEQUENCE patient_quotes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_quotes_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_report_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_report_jobs TO practice_manager_app;

--
-- Name: SEQUENCE patient_report_jobs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_report_jobs_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_service_agreements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_service_agreements TO practice_manager_app;

--
-- Name: SEQUENCE patient_service_agreements_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_service_agreements_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_transcript_scribe_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_transcript_scribe_jobs TO practice_manager_app;

--
-- Name: SEQUENCE patient_transcript_scribe_jobs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_transcript_scribe_jobs_id_seq TO practice_manager_app;

--
-- Name: TABLE patient_transcriptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patient_transcriptions TO practice_manager_app;

--
-- Name: SEQUENCE patient_transcriptions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patient_transcriptions_id_seq TO practice_manager_app;

--
-- Name: TABLE patients; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patients TO practice_manager_app;

--
-- Name: SEQUENCE patients_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.patients_id_seq TO practice_manager_app;

--
-- Name: TABLE practice_locations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.practice_locations TO practice_manager_app;

--
-- Name: SEQUENCE practice_locations_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.practice_locations_id_seq TO practice_manager_app;

--
-- Name: TABLE practitioner_services; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.practitioner_services TO practice_manager_app;

--
-- Name: SEQUENCE practitioner_services_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.practitioner_services_id_seq TO practice_manager_app;

--
-- Name: TABLE practitioners; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.practitioners TO practice_manager_app;

--
-- Name: SEQUENCE practitioners_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.practitioners_id_seq TO practice_manager_app;

--
-- Name: TABLE quote_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quote_items TO practice_manager_app;

--
-- Name: SEQUENCE quote_items_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.quote_items_id_seq TO practice_manager_app;

--
-- Name: TABLE report_domain_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.report_domain_settings TO practice_manager_app;

--
-- Name: SEQUENCE report_domain_settings_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.report_domain_settings_id_seq TO practice_manager_app;

--
-- Name: TABLE report_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.report_templates TO practice_manager_app;

--
-- Name: SEQUENCE report_templates_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.report_templates_id_seq TO practice_manager_app;

--
-- Name: TABLE service_agreement_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_agreement_items TO practice_manager_app;

--
-- Name: SEQUENCE service_agreement_items_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.service_agreement_items_id_seq TO practice_manager_app;

--
-- Name: TABLE services; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.services TO practice_manager_app;

--
-- Name: SEQUENCE services_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.services_id_seq TO practice_manager_app;

--
-- Name: TABLE system_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.system_settings TO practice_manager_app;

--
-- Name: TABLE task_entries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_entries TO practice_manager_app;

--
-- Name: SEQUENCE task_entries_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.task_entries_id_seq TO practice_manager_app;

--
-- Name: TABLE user_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_settings TO practice_manager_app;

--
-- Name: TABLE waitlist_entries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waitlist_entries TO practice_manager_app;

--
-- Name: SEQUENCE waitlist_entries_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.waitlist_entries_id_seq TO practice_manager_app;

--
-- Name: TABLE waitlist_offers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waitlist_offers TO practice_manager_app;

--
-- Name: SEQUENCE waitlist_offers_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.waitlist_offers_id_seq TO practice_manager_app;

--

