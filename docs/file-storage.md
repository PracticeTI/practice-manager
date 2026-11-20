# File storage

Uploaded files have two halves: a row in `patient_files` that records the name, size,
owner and uploader, and the bytes themselves. The row always lives in PostgreSQL. The
bytes live wherever the practice's `fileStorageBackend` points.

The default backend is `database`, which keeps the bytes in `patient_files.file_data`
in a `BYTEA` column. Nothing has to be configured for that.

A practice can move new uploads out of the database from **Admin → Settings → Domains →
Features → File storage**. The choice is per practice, so one practice can use a bucket
while another in the same deployment keeps using the database.

| Backend | Where the bytes go | Typical mode |
|---------|--------------------|--------------|
| `database` | `patient_files.file_data` | any; the default |
| `local` | a directory on the host (`FILE_STORAGE_DIR`) | Solo (Docker volume), Solo (Desktop), LAN |
| `s3` | an S3 or S3-compatible bucket | Cloud, LAN with an object store |
| `gcs` | a Google Cloud Storage bucket | Cloud (Cloud Run) |

`local` is not usable on a serverless host (Vercel, Cloud Run with a plain container
filesystem), because the filesystem is ephemeral and read-only at runtime. The Files
page reports that rather than failing on the first upload — see
`describeFileStorageBackend` in `apps/core/src/lib/fileStorageConfig.js`.

Row-level security still applies: every read and write goes through
`withPostgresRlsContext`, and the object key always carries the practice's domain, so a
practice's files stay in its own namespace even in a shared bucket.

## How a file is stored

1. The upload is written to `patient_files` first, with `storage_backend` set and
   `file_data` filled only for the database backend.
2. For an external backend the object key is built from the row id
   (`domains/<domain>/patients/<patientId>/<fileId>-<name>`, or
   `domains/<domain>/practice/<fileId>-<name>` for a practice-level file) and the bytes
   are uploaded to that key.
3. The key is written back to `storage_key`. A failed upload deletes the row again, so a
   listing never shows a file whose bytes never arrived.

Reads use the backend named on the row, not the practice's current setting. Changing the
setting therefore only affects new uploads, and existing files stay downloadable as long
as the old backend is still configured. If it is not, the download answers `503` with the
reason instead of a misleading `404`.

## The Files page

`/admin/files` is the practice's upload library. It is opt-in per domain (`filesEnabled`
in Settings → Domains, off by default) and shown behind the dashboard's Files card.

- **Patient files** are the same rows a patient's Files tab lists.
- **Practice-level files** have no patient (`patient_id IS NULL`). They are uploaded from
  `/admin/files` by choosing "Practice (no patient)".
- The page reports which backend new uploads will use, and disables upload when this
  deployment cannot use the configured backend.

## Environment variables

All are optional except where marked. The deployment sets them; a practice cannot point
itself at a bucket the deployment has no credentials for.

| Variable | Backend | Meaning |
|----------|---------|---------|
| `FILE_STORAGE_DIR` | `local` | Absolute path to the storage root (mount a volume here in containers) |
| `FILE_STORAGE_PREFIX` | all external | Optional namespace inside the bucket/root; keys become `<prefix>/domains/<domain>/...` |
| `FILE_STORAGE_S3_BUCKET` | `s3` | Bucket name (falls back to `AWS_S3_BUCKET`) |
| `FILE_STORAGE_S3_REGION` | `s3` | Region (falls back to `AWS_REGION`, then `us-east-1`) |
| `FILE_STORAGE_S3_ENDPOINT` | `s3` | Endpoint for S3-compatible stores (MinIO, R2); also turns on path-style addressing |
| `FILE_STORAGE_S3_ACCESS_KEY_ID` | `s3` | Access key (falls back to `AWS_ACCESS_KEY_ID`) |
| `FILE_STORAGE_S3_SECRET_ACCESS_KEY` | `s3` | Secret key (falls back to `AWS_SECRET_ACCESS_KEY`) |
| `FILE_STORAGE_S3_SESSION_TOKEN` | `s3` | Optional session token (falls back to `AWS_SESSION_TOKEN`) |
| `FILE_STORAGE_S3_FORCE_PATH_STYLE` | `s3` | `true` to force path-style URLs without a custom endpoint |
| `FILE_STORAGE_GCS_BUCKET` | `gcs` | Bucket name (falls back to `GCS_BUCKET`) |
| `FILE_STORAGE_GCS_SERVICE_ACCOUNT_JSON` | `gcs` | Inline service-account JSON |
| `FILE_STORAGE_GCS_SERVICE_ACCOUNT_PATH` | `gcs` | Path to a service-account JSON file (falls back to `GOOGLE_APPLICATION_CREDENTIALS`) |
| `FILE_STORAGE_GCS_ACCESS_TOKEN` | `gcs` | A pre-issued access token, for hosts that mint one elsewhere |
| `FILE_STORAGE_GCS_ENDPOINT` | `gcs` | Override for emulators; defaults to `https://storage.googleapis.com` |

On Cloud Run and GCE the GCS backend can also use the instance's metadata-server
credentials, so no key file is needed there.

## Deployment modes

The same code serves every mode; only the environment differs.

- **Solo (Desktop)** — `local` pointed at a directory under the operator's data folder.
- **Solo (Docker)** — `local` pointed at a mounted volume.
- **LAN** — `local` on a shared volume/NAS, or `s3`/`gcs` for a central store.
- **Cloud** — `s3` or `gcs`; `local` is rejected because the filesystem is ephemeral.

## Where the code lives

- `apps/core/src/lib/fileStorageConfig.js` — backends, per-practice choice, availability
- `apps/core/src/lib/fileStoragePaths.js` — object key naming
- `apps/core/src/lib/fileStorageSigning.js` — S3 SigV4 and the GCS service-account JWT
- `apps/core/src/lib/fileStorageBackends.js` — local/S3/GCS put, get, delete
- `apps/core/src/lib/fileStore.js` — row plus bytes, under RLS
- `apps/core/src/app/api/database/patient-files/**` — list, upload, download, delete
- `apps/core/src/app/admin/files/page.jsx` — the Files page

`packages/storage/` is reserved for this abstraction. When the core app starts importing
business logic from `packages/*`, these modules are the intended first move; until then
they live beside the routes that use them so the migration stays a move rather than a
rewrite.

## Size limits

Uploads are capped at 25 MB per file in
`apps/core/src/app/api/database/patient-files/route.js`, and `next.config.js` raises the
proxy body limit above that so multipart uploads are not truncated before the route sees
them.

## Object signing

The S3 and GCS backends talk to their HTTP APIs directly with `node:crypto` rather than
through cloud SDKs. The SigV4 signer is covered by the AWS documentation example and by
botocore-derived vectors in `apps/core/test/fileStorageSigning.test.js`, the GCS
service-account assertion is verified against a generated RSA key pair there, and the S3
and GCS request shapes are asserted against a stubbed `fetch` in
`apps/core/test/fileStorageBackends.test.js`.
