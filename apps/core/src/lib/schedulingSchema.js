// SQL definitions for the native scheduling layer.
//
// This module intentionally has no imports: the API helpers resolve it through
// the `@/` alias, while `scripts/migrate-scheduling-phase0.mjs` imports the same
// statements with a relative path so schema changes can never drift between the
// application and the migration.

export const DEFAULT_SCHEDULING_TIMEZONE = 'Australia/Sydney'

export const APPOINTMENTS_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        external_id VARCHAR(120),
        external_source VARCHAR(64) NOT NULL DEFAULT 'manual',
        patient_id INTEGER,
        patient_name VARCHAR(255),
        external_patient_id VARCHAR(120),
        practitioner VARCHAR(255),
        external_practitioner_id VARCHAR(120),
        service VARCHAR(255),
        external_service_id VARCHAR(120),
        location VARCHAR(255),
        external_location_id VARCHAR(120),
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        progress_note_status VARCHAR(32),
        patient_status VARCHAR(32),
        unavailable_block BOOLEAN NOT NULL DEFAULT FALSE,
        is_group BOOLEAN NOT NULL DEFAULT FALSE,
        is_repeating BOOLEAN NOT NULL DEFAULT FALSE,
        repeating_rule VARCHAR(255),
        max_patients INTEGER,
        price NUMERIC(12,2),
        unit VARCHAR(32),
        tax_type VARCHAR(64),
        tax_rate NUMERIC(6,3),
        notes TEXT,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )
`

export const APPOINTMENTS_BASE_INDEX_STATEMENTS = [
    'CREATE INDEX IF NOT EXISTS appointments_domain_idx ON appointments(domain)',
    'CREATE INDEX IF NOT EXISTS appointments_domain_patient_idx ON appointments(domain, patient_id)',
    'CREATE INDEX IF NOT EXISTS appointments_domain_start_idx ON appointments(domain, starts_at)',
    // NULLs are distinct in a PostgreSQL unique index, so manual appointments
    // without an external id never collide.
    `CREATE UNIQUE INDEX IF NOT EXISTS appointments_domain_source_external_idx
        ON appointments(domain, external_source, external_id)`,
]

// Native columns are additive. The legacy `practitioner` / `service` / `location`
// text columns stay in place as import provenance while the linked ids become
// the model used by the calendar and booking engine.
export const APPOINTMENT_NATIVE_COLUMN_STATEMENTS = [
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS practitioner_id INTEGER',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location_id INTEGER',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id INTEGER',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS case_id INTEGER',
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_status VARCHAR(24) NOT NULL DEFAULT 'confirmed'",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_source VARCHAR(32) NOT NULL DEFAULT 'manual'",
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booked_by VARCHAR(255)',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS telehealth_url TEXT',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurrence_id INTEGER',
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) NOT NULL DEFAULT '${DEFAULT_SCHEDULING_TIMEZONE}'`,
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(32) NOT NULL DEFAULT 'pending'",
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ',
    'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_channel VARCHAR(32)',
]

export const APPOINTMENT_NATIVE_INDEX_STATEMENTS = [
    'CREATE INDEX IF NOT EXISTS appointments_domain_practitioner_start_idx ON appointments(domain, practitioner_id, starts_at)',
    'CREATE INDEX IF NOT EXISTS appointments_domain_status_start_idx ON appointments(domain, appointment_status, starts_at)',
    'CREATE INDEX IF NOT EXISTS appointments_domain_service_idx ON appointments(domain, service_id)',
    'CREATE INDEX IF NOT EXISTS appointments_domain_location_idx ON appointments(domain, location_id)',
    'CREATE INDEX IF NOT EXISTS appointments_domain_case_idx ON appointments(domain, case_id)',
    'CREATE INDEX IF NOT EXISTS appointments_domain_external_idx ON appointments(domain, external_id)',
    'CREATE INDEX IF NOT EXISTS appointments_domain_confirmation_idx ON appointments(domain, confirmation_status)',
]

export const SCHEDULING_TABLE_STATEMENTS = [
    `
        CREATE TABLE IF NOT EXISTS practitioners (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            admin_user_id INTEGER,
            display_name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            discipline VARCHAR(120),
            provider_number VARCHAR(64),
            timezone VARCHAR(100) NOT NULL DEFAULT '${DEFAULT_SCHEDULING_TIMEZONE}',
            default_location_id INTEGER,
            colour VARCHAR(16),
            active BOOLEAN NOT NULL DEFAULT TRUE,
            external_id VARCHAR(120),
            external_source VARCHAR(64),
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS practice_locations (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            name VARCHAR(255) NOT NULL,
            location_type VARCHAR(24) NOT NULL DEFAULT 'clinic',
            address_line1 VARCHAR(255),
            address_line2 VARCHAR(255),
            suburb VARCHAR(120),
            state VARCHAR(32),
            postcode VARCHAR(16),
            country VARCHAR(64) NOT NULL DEFAULT 'Australia',
            latitude NUMERIC(9,6),
            longitude NUMERIC(9,6),
            timezone VARCHAR(100) NOT NULL DEFAULT '${DEFAULT_SCHEDULING_TIMEZONE}',
            travel_fee_rule VARCHAR(32) NOT NULL DEFAULT 'none',
            active BOOLEAN NOT NULL DEFAULT TRUE,
            external_id VARCHAR(120),
            external_source VARCHAR(64),
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS services (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            name VARCHAR(255) NOT NULL,
            code VARCHAR(64),
            duration_minutes INTEGER NOT NULL DEFAULT 60,
            buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
            buffer_after_minutes INTEGER NOT NULL DEFAULT 0,
            price NUMERIC(12,2),
            gst_applicable BOOLEAN NOT NULL DEFAULT TRUE,
            funding_types JSONB NOT NULL DEFAULT '[]'::jsonb,
            ndis_support_item_number VARCHAR(48),
            ndis_support_item_name VARCHAR(255),
            telehealth_allowed BOOLEAN NOT NULL DEFAULT TRUE,
            mobile_allowed BOOLEAN NOT NULL DEFAULT TRUE,
            colour VARCHAR(16),
            active BOOLEAN NOT NULL DEFAULT TRUE,
            external_id VARCHAR(120),
            external_source VARCHAR(64),
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            CONSTRAINT services_duration_positive CHECK (duration_minutes > 0)
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS practitioner_services (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            practitioner_id INTEGER NOT NULL,
            service_id INTEGER NOT NULL,
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS availability_rules (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            practitioner_id INTEGER NOT NULL,
            location_id INTEGER,
            service_id INTEGER,
            weekday SMALLINT NOT NULL,
            start_time TIME NOT NULL,
            end_time TIME NOT NULL,
            valid_from DATE,
            valid_to DATE,
            rrule VARCHAR(255),
            active BOOLEAN NOT NULL DEFAULT TRUE,
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            CONSTRAINT availability_rules_weekday_range CHECK (weekday BETWEEN 0 AND 6),
            CONSTRAINT availability_rules_time_order CHECK (end_time > start_time)
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS availability_exceptions (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            practitioner_id INTEGER NOT NULL,
            exception_type VARCHAR(24) NOT NULL DEFAULT 'leave',
            starts_at TIMESTAMPTZ NOT NULL,
            ends_at TIMESTAMPTZ NOT NULL,
            note TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            CONSTRAINT availability_exceptions_time_order CHECK (ends_at > starts_at)
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS calendar_connections (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            practitioner_id INTEGER NOT NULL,
            provider VARCHAR(24) NOT NULL,
            external_account_email VARCHAR(255),
            access_token_encrypted TEXT NOT NULL,
            refresh_token_encrypted TEXT,
            token_expires_at TIMESTAMPTZ,
            scopes TEXT,
            status VARCHAR(24) NOT NULL DEFAULT 'connected',
            last_synced_at TIMESTAMPTZ,
            last_sync_error TEXT,
            sync_window_days INTEGER NOT NULL DEFAULT 60,
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS calendar_busy_blocks (
            id BIGSERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            connection_id INTEGER NOT NULL,
            practitioner_id INTEGER NOT NULL,
            external_event_id VARCHAR(255),
            starts_at TIMESTAMPTZ NOT NULL,
            ends_at TIMESTAMPTZ NOT NULL,
            busy_status VARCHAR(16) NOT NULL DEFAULT 'busy',
            title VARCHAR(255),
            synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata JSONB,
            CONSTRAINT calendar_busy_blocks_time_order CHECK (ends_at > starts_at)
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS appointment_reminders (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            appointment_id INTEGER NOT NULL,
            patient_id INTEGER,
            kind VARCHAR(24) NOT NULL DEFAULT 'reminder',
            channel VARCHAR(16) NOT NULL DEFAULT 'auto',
            offset_hours INTEGER NOT NULL,
            appointment_starts_at TIMESTAMPTZ NOT NULL,
            scheduled_for TIMESTAMPTZ NOT NULL,
            status VARCHAR(24) NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            sent_at TIMESTAMPTZ,
            provider VARCHAR(32),
            provider_message_id TEXT,
            error_message TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS waitlist_entries (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            patient_id INTEGER,
            patient_name VARCHAR(255) NOT NULL,
            service_id INTEGER,
            practitioner_id INTEGER,
            location_id INTEGER,
            priority INTEGER NOT NULL DEFAULT 0,
            earliest_date DATE,
            latest_date DATE,
            status VARCHAR(24) NOT NULL DEFAULT 'waiting',
            notes TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS waitlist_offers (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(100) NOT NULL,
            waitlist_entry_id INTEGER NOT NULL,
            appointment_id INTEGER,
            token VARCHAR(160) NOT NULL,
            status VARCHAR(24) NOT NULL DEFAULT 'offered',
            starts_at TIMESTAMPTZ NOT NULL,
            ends_at TIMESTAMPTZ NOT NULL,
            practitioner_id INTEGER,
            service_id INTEGER,
            location_id INTEGER,
            channel VARCHAR(16),
            expires_at TIMESTAMPTZ NOT NULL,
            sent_at TIMESTAMPTZ,
            responded_at TIMESTAMPTZ,
            metadata JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            CONSTRAINT waitlist_offers_time_order CHECK (ends_at > starts_at)
        )
    `,
    `
        CREATE TABLE IF NOT EXISTS api_rate_limits (
            bucket_key VARCHAR(200) PRIMARY KEY,
            window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            request_count INTEGER NOT NULL DEFAULT 0
        )
    `,
]

export const SCHEDULING_COLUMN_STATEMENTS = [
    'ALTER TABLE practitioner_services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()',
]

export const SCHEDULING_INDEX_STATEMENTS = [
    'CREATE INDEX IF NOT EXISTS practitioners_domain_idx ON practitioners(domain)',
    'CREATE INDEX IF NOT EXISTS practitioners_domain_active_idx ON practitioners(domain, active)',
    `CREATE UNIQUE INDEX IF NOT EXISTS practitioners_domain_source_external_idx
        ON practitioners(domain, external_source, external_id)`,
    'CREATE INDEX IF NOT EXISTS practice_locations_domain_idx ON practice_locations(domain)',
    'CREATE INDEX IF NOT EXISTS practice_locations_domain_active_idx ON practice_locations(domain, active)',
    `CREATE UNIQUE INDEX IF NOT EXISTS practice_locations_domain_source_external_idx
        ON practice_locations(domain, external_source, external_id)`,
    'CREATE INDEX IF NOT EXISTS services_domain_idx ON services(domain)',
    'CREATE INDEX IF NOT EXISTS services_domain_active_idx ON services(domain, active)',
    `CREATE UNIQUE INDEX IF NOT EXISTS services_domain_source_external_idx
        ON services(domain, external_source, external_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS practitioner_services_domain_pair_idx
        ON practitioner_services(domain, practitioner_id, service_id)`,
    'CREATE INDEX IF NOT EXISTS practitioner_services_domain_service_idx ON practitioner_services(domain, service_id)',
    'CREATE INDEX IF NOT EXISTS availability_rules_domain_practitioner_idx ON availability_rules(domain, practitioner_id)',
    'CREATE INDEX IF NOT EXISTS availability_rules_domain_weekday_idx ON availability_rules(domain, practitioner_id, weekday)',
    'CREATE INDEX IF NOT EXISTS availability_exceptions_domain_practitioner_start_idx ON availability_exceptions(domain, practitioner_id, starts_at)',
    `CREATE UNIQUE INDEX IF NOT EXISTS calendar_connections_domain_practitioner_provider_idx
        ON calendar_connections(domain, practitioner_id, provider)`,
    'CREATE INDEX IF NOT EXISTS calendar_connections_domain_idx ON calendar_connections(domain)',
    'CREATE INDEX IF NOT EXISTS calendar_busy_blocks_domain_practitioner_start_idx ON calendar_busy_blocks(domain, practitioner_id, starts_at)',
    'CREATE INDEX IF NOT EXISTS calendar_busy_blocks_connection_start_idx ON calendar_busy_blocks(connection_id, starts_at)',
    `CREATE UNIQUE INDEX IF NOT EXISTS appointment_reminders_domain_appointment_offset_idx
        ON appointment_reminders(domain, appointment_id, offset_hours)`,
    'DROP INDEX IF EXISTS appointment_reminders_domain_appointment_key_idx',
    `DELETE FROM appointment_reminders a
        USING appointment_reminders b
        WHERE a.id > b.id
          AND a.domain = b.domain
          AND a.appointment_id = b.appointment_id
          AND a.offset_hours = b.offset_hours`,
    'CREATE INDEX IF NOT EXISTS appointment_reminders_domain_due_idx ON appointment_reminders(domain, status, scheduled_for)',
    'CREATE INDEX IF NOT EXISTS appointment_reminders_domain_appointment_idx ON appointment_reminders(domain, appointment_id)',
    'CREATE INDEX IF NOT EXISTS waitlist_entries_domain_status_idx ON waitlist_entries(domain, status)',
    'CREATE INDEX IF NOT EXISTS waitlist_entries_domain_service_idx ON waitlist_entries(domain, service_id)',
    `CREATE UNIQUE INDEX IF NOT EXISTS waitlist_offers_token_idx ON waitlist_offers(token)`,
    'CREATE INDEX IF NOT EXISTS waitlist_offers_domain_entry_idx ON waitlist_offers(domain, waitlist_entry_id)',
    'CREATE INDEX IF NOT EXISTS waitlist_offers_domain_status_idx ON waitlist_offers(domain, status, expires_at)',
]

export const APPOINTMENT_CONFLICT_CONSTRAINT_NAME = 'appointments_practitioner_no_overlap'

// Applied by the migration only after the legacy data has been checked for
// overlaps. `btree_gist` provides the equality operator classes needed to mix
// the scalar columns with the range overlap operator.
export const APPOINTMENT_CONFLICT_CONSTRAINT_SQL = `
    ALTER TABLE appointments
    ADD CONSTRAINT ${APPOINTMENT_CONFLICT_CONSTRAINT_NAME}
    EXCLUDE USING gist (
        domain WITH =,
        practitioner_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    )
    WHERE (
        practitioner_id IS NOT NULL
        AND starts_at IS NOT NULL
        AND ends_at IS NOT NULL
        AND appointment_status IN ('tentative', 'confirmed', 'arrived')
        AND COALESCE(unavailable_block, FALSE) = FALSE
        AND COALESCE(archived, FALSE) = FALSE
    )
`
