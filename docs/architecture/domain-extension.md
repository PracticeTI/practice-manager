# Domain branding and extension layer

Status: **draft** · Audience: operators deploying under their own domain, and contributors.

This repository ships a single unbranded `default` domain. Everything that makes a
deployment look like a particular practice — hostnames, brand marks, colour tokens,
per-site pages and content — arrives through an optional **extension layer** at build
time, not from this tree.

## What the core ships

- One domain mode, `default`, with neutral branding and a generic landing layout.
- Generic accessors only: the list of configured domains, hostname and label mappings,
  display labels, and selection of the default domain. The core never names a domain.
- No hostnames, brand assets, customer content or assessment templates belonging to a
  specific practice.

## What an operator supplies

An extension layer may contain any of the following, using the same shape as the core:

| Content | Where it lives in the layer |
|---|---|
| Domain descriptors — key, label, description, hostnames, host label hints, canonical origin, SEO defaults, feature flags, design tokens, brand marks | `packages/branding/` |
| Domain-specific pages and API routes | `apps/core/src/app/<domain>/` |
| Brand imagery and fonts | `apps/core/public/` |
| Report and document templates | `apps/core/content/` |
| A hosting profile for the operator's environment | `deploy/cloud/<profile>/` |
| `/api` routes that must stay reachable without a session — exported as `PRIVATE_PUBLIC_API_ROUTES` | `apps/core/src/lib/privateDomains.data.js`, next to the descriptors |

Domain descriptors must stay **pure data** — no React, no Next.js imports — because
edge middleware and build configuration read them before any React runtime exists.

## How the layer is mounted

- The layer mirrors this repository's paths one-to-one, so `overlay/<path>` is copied to
  `<path>`. Keeping the mirror rule trivial is what lets a monorepo and a single-repo
  layout share one sync script.
- The path is supplied by configuration (for example an environment variable pointing at
  a checkout or a mounted volume). This repository commits no reference to any private
  remote, so a fork carries no dangling configuration.
- A sync step copies the tree into place and records exactly which paths it wrote, so
  `git status` stays clean and a check command can prove the public tree is unmodified.
  A matching clean command must be able to unmount the layer and leave a pristine tree.
- When no layer is configured, generated bridge modules are empty stubs and every
  consumer behaves as if no extension domains exist.

## Safety property

A deployment expected to serve operator domains must fail its build when the layer is
absent. The failure mode to avoid is a build that silently succeeds, resolves an
operator hostname to `default`, and serves neutral branding under a practice's URL.
Treat the "require the layer" flag as mandatory for any such deployment, and verify it
in CI rather than only in the hosting dashboard.

## Rules for contributors

- Do not reference an operator's domain, repository or brand asset from core code. Add a
  descriptor field and a small accessor instead.
- Do not commit operator content to this repository, including in tests and fixtures.
- Run the check command before publishing; a contributor branch that picked up layer
  files by accident is a disclosure, not a merge conflict.

## Relationship to the licence

The extension layer is a branding and configuration boundary. It is not how the free and
paid offerings differ: the paid difference is who operates the software, not which
clinical functions are present. See [LICENSE](../../LICENSE) for the licence terms and
the project notice on commercial licensing.
