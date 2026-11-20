/**
 * Core content schema.
 *
 * These are the tables the public site and admin content screens assume exist from the
 * very first request: settings, content, content relationships, and the billing account
 * table. They were previously created only by the operator route
 * `POST /api/database/create-tables`, which a fresh install never calls — so the bootstrap
 * and that route now share one statement list.
 *
 * `CREATE TABLE IF NOT EXISTS` keeps this safe to run on every start, and alongside the
 * per-module `ensure*Table` helpers that create the same tables with the same shapes.
 */

import { DEFAULT_CONTENT_DOMAIN } from '@/lib/domainMode'

/** PostgreSQL statements for the core content schema, in dependency order. */
export function coreSchemaStatements() {
  const defaultContentDomain = DEFAULT_CONTENT_DOMAIN.replaceAll("'", "''")

  return [
    `CREATE TABLE IF NOT EXISTS system_settings (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS domain_settings (
      domain VARCHAR(100) NOT NULL,
      key VARCHAR(255) NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (domain, key)
    )`,
    `CREATE TABLE IF NOT EXISTS content (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      subtype VARCHAR(50),
      domain VARCHAR(64) NOT NULL DEFAULT '${defaultContentDomain}',
      slug VARCHAR(255) NOT NULL,
      title VARCHAR(255),
      name VARCHAR(255),
      summary TEXT,
      body TEXT,
      status VARCHAR(50) DEFAULT 'draft',
      published_at TIMESTAMPTZ,
      attributes JSONB DEFAULT '{}'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(type, slug)
    )`,
    `CREATE INDEX IF NOT EXISTS content_subtype_idx ON content(subtype)`,
    `CREATE INDEX IF NOT EXISTS content_type_idx ON content(type)`,
    `CREATE INDEX IF NOT EXISTS content_domain_idx ON content(domain)`,
    `CREATE INDEX IF NOT EXISTS content_domain_status_idx ON content(domain, status)`,
    `CREATE INDEX IF NOT EXISTS content_slug_idx ON content(slug)`,
    `CREATE INDEX IF NOT EXISTS content_status_idx ON content(status)`,
    `CREATE INDEX IF NOT EXISTS content_published_at_idx ON content(published_at)`,
    `CREATE TABLE IF NOT EXISTS content_relationships (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      relationship_type VARCHAR(50) NOT NULL,
      role VARCHAR(255),
      position INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, target_id, relationship_type)
    )`,
    `CREATE INDEX IF NOT EXISTS content_rel_source_idx ON content_relationships(source_id)`,
    `CREATE INDEX IF NOT EXISTS content_rel_target_idx ON content_relationships(target_id)`,
    `CREATE INDEX IF NOT EXISTS content_rel_type_idx ON content_relationships(relationship_type)`,
    `CREATE TABLE IF NOT EXISTS billing (
      id SERIAL PRIMARY KEY,
      domain VARCHAR(100) NOT NULL,
      account_id VARCHAR(255) NOT NULL,
      account_name VARCHAR(255),
      metadata JSONB
    )`,
    `CREATE INDEX IF NOT EXISTS billing_account_idx ON billing(account_id)`,
    `CREATE INDEX IF NOT EXISTS billing_domain_idx ON billing(domain)`,
  ]
}
