# Practice Manager

Practice Manager is an open-source project for managing the day-to-day work of
health and allied-health practices.

## Project structure

The repository is laid out as an npm-workspaces monorepo. `apps/` holds deployable
processes, `packages/` holds code they import, and `deploy/` holds the packaging and
hosting configuration for each deployment mode.

```text
practice-manager/
├── apps/
│   ├── core/                  # Next.js app: public site, /admin, /api/*
│   │   ├── src/app/
│   │   ├── src/components/
│   │   ├── src/admin-ui/
│   │   ├── src/lib/           # app wiring; business logic lives in packages/
│   │   ├── public/
│   │   ├── content/           # report templates and seeded content files
│   │   ├── middleware.js
│   │   ├── next.config.js
│   │   └── package.json
│   │
│   ├── runtime/               # worker, queue and health service
│   │   ├── src/app/api/       # health, */queue, */worker/run
│   │   ├── src/lib/
│   │   ├── scheduler.js       # service mode and one-shot job-drain mode
│   │   └── package.json
│   │
│   └── desktop/               # Electron shell around the core app
│       ├── main/              # window lifecycle, loopback server, single-instance lock
│       ├── preload/           # contextBridge API surface
│       ├── preflight/         # Node and PostgreSQL detection, version and health checks
│       ├── setup/             # first-run wizard: database connection and migrations
│       └── package.json
│
├── packages/
│   ├── contracts/             # queue/worker payloads, service auth, plugin manifest
│   ├── db/                    # client, schema, migrations, seeds, RLS policies, scoped connection
│   │   ├── src/
│   │   ├── migrations/
│   │   └── seeds/
│   ├── jobs/                  # worker cycles shared by runtime and desktop inline mode
│   ├── privacy/               # de-identification, egress policy, identity handling
│   ├── practice/              # domain logic: patients, cases, notes, appointments, billing
│   ├── ai/                    # provider clients, model catalog, usage accounting
│   ├── storage/               # adapter interface plus local, volume and object backends
│   ├── identity/              # local single-user, local accounts, OAuth; role model
│   ├── branding/              # default domain, design tokens, private-overlay accessors
│   └── config/                # deployment profile and capability resolution
│       └── src/profiles/      # solo-desktop.js, solo-docker.js, lan.js, cloud.js
│
├── src/private/               # optional operator extension layer (not committed; see below)
│
├── deploy/
│   ├── desktop/               # Electron builder config, signing, update feed
│   ├── docker/                # Dockerfile.core, Dockerfile.runtime, compose.yml, env/
│   ├── lan/                   # TLS termination, backup and restore, upgrade assets
│   └── cloud/                 # Vercel config, Cloud Run job specs, infrastructure defaults
│
├── scripts/                   # development and maintenance scripts
├── test/e2e/                  # cross-app tests; unit tests sit beside their package
├── docs/                      # goals, guides, architecture, deployment, security, roadmap
└── package.json               # npm workspaces, single version and release train
```

Documentation is organised under `docs/`:

- `docs/introduction/` — project goals and concepts
- `docs/user-guide/` — guidance for people using Practice Manager
- `docs/developer-guide/` — development setup and contribution details
- `docs/architecture/` — system design and technical decisions
- `docs/deployment/` — installation and operations guidance, with one page per mode under `docs/deployment/modes/`
- `docs/security/` — security policy and guidance
- `docs/roadmap/` — planned work and project direction

## Deployment modes

Every mode runs the same `apps/core` and `packages/*`; they differ in hosting,
identity, storage and how worker jobs execute. Modes are expressed as profiles in
`packages/config`, not as separate source trees.

| Mode | Core | Workers | Database | Storage | Identity |
|------|------|---------|----------|---------|----------|
| Solo (Desktop) | Electron shell, loopback only | inline | locally installed PostgreSQL | local files | single local operator |
| Solo (Docker) | container | sidecar container or inline | compose PostgreSQL | volume | single local operator |
| LAN | container behind reverse proxy | sidecar container | compose or external PostgreSQL | volume or NAS | local practice accounts |
| Cloud | managed host (e.g. Vercel) | managed one-shot jobs | managed PostgreSQL | object storage | OAuth / admin JWT |

Row-level security is a capability flag rather than an invariant: it is enforced where
more than one principal can reach the database (LAN, Cloud) and skipped where the app
connects as a single local operator.

## Desktop prerequisites

Solo (Desktop) does not bundle or require Docker. The desktop app expects the operator
to have installed:

- **Node.js** matching `engines` in the relevant `package.json` (currently
  `>=22.13.0 <23 || >=24`).
- **PostgreSQL**, running locally and reachable over a normal connection URL.
- **Redis** only if the operator enables queue-backed workers instead of inline jobs.

`apps/desktop/preflight` probes both prerequisites on launch and reports actionable
failures; `apps/desktop/setup` guides the first run through creating the database,
applying migrations from `packages/db/migrations`, and saving the connection string.

## Domain branding and extensions

The public distribution ships a single unbranded `default` domain and no customer
names, brand assets or site content. Additional domains and branding are supplied at
build time by an optional **extension layer**: an operator-owned tree whose paths mirror
this repository's layout. The core contains only generic accessors, so a build with no
extension layer succeeds and serves the default domain.

A deployment that does supply branding must make its build fail when the layer is
missing, rather than silently serving the default domain under someone else's
hostname. See [docs/architecture/domain-extension.md](docs/architecture/domain-extension.md).

This is a branding boundary, not a licensing one. The extension layer carries names,
imagery and per-site content; it never carries clinical capability. Per
[LICENSE](LICENSE), the code in this repository is AGPL-3.0 and Asentic retains the right
to offer the software under separate commercial terms. A managed or hosted arrangement
changes who operates the software, not what it can do.

## Status

This commit adds the directory skeleton only. Application source from the existing
core and runtime repositories has not been moved yet, and the root `package.json`
workspace definitions will land with that migration.

## License

Practice Manager is licensed under the GNU Affero General Public License,
version 3. See [LICENSE](LICENSE) for the license terms and project notice.
