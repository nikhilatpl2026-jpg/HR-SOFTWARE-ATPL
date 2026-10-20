-- ATPL Cloud SQL PostgreSQL authoritative sync schema.
-- Apply only to a NEW, private database. No existing ERP data is touched.
BEGIN;
CREATE TABLE IF NOT EXISTS atpl_files (
  id text PRIMARY KEY,
  module text NOT NULL,
  name text NOT NULL,
  sha256_hash text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS atpl_files_module_idx ON atpl_files(module, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS atpl_files_module_hash_unique
  ON atpl_files(module, sha256_hash) WHERE sha256_hash <> '';
CREATE TABLE IF NOT EXISTS atpl_tombstones (
  key text PRIMARY KEY,
  file_id text NOT NULL,
  module text NOT NULL,
  name text NOT NULL,
  sha256_hash text NOT NULL DEFAULT '',
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by text NOT NULL DEFAULT 'system'
);
CREATE TABLE IF NOT EXISTS atpl_employees (
  emp_id text PRIMARY KEY,
  record jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atpl_employee_tombstones (
  emp_id text PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atpl_events (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
