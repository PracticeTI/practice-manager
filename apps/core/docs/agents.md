# Agents and domain modes

**Repository**: `PracticeTI/practice-manager`. The app is `apps/core`; shared logic
lives in `packages/*`. See [../../../README.md](../../../README.md) for the layout.

## Domain mode resolution

- Admin → Settings → Default Domain (saved in browser localStorage) takes precedence over
  URL/hostname auto-detection.
- With no saved preference, the mode falls back to hostname detection, then to the
  overlay-selected default, then to the public `default` domain.
- The public domain registry contains only `default` (`CORE_DOMAIN_MODES` in
  `src/lib/domainMode.js`). Branded domains are supplied by the extension layer.
- Only identifiers in `VALID_DOMAIN_MODES` resolve. A path prefix, saved preference,
  header, cookie or hostname naming anything else falls through to the default domain.
- The Default Domain selector offers only configured domains
  (`isDefaultDomainSelectorOption` in `src/lib/domainSettings.js`), so a key left in
  saved settings by a retired mode is never selectable.
- Implementation: `src/lib/domainMode.js`.

## Domain branding and extensions

Domains, brand marks, colour tokens and per-site content are **not** part of this
repository. They arrive through the operator's extension layer; see
[domain-extension.md](../../../docs/architecture/domain-extension.md) and
[private-domains.md](private-domains.md).

- Never add a customer domain name, hostname, brand asset or design token here.
- Add a descriptor field in the extension layer and a small accessor in
  `src/lib/domainExtension.js` instead.
- Run `npm run private:clean` and `npm run private:check` before publishing.

## AI workers

The worker cards a domain can show are defined in `src/lib/aiWorkers.js`. Which of them
a domain displays is stored per domain in Admin → Settings → Domains, and reads still
honour the retired `asenticWorkerVisibility` settings key.

## Dev server

`npm run dev` serves the app on http://localhost:3000 — public site at `/`, admin at
`/admin`, routes under `/api/*`.

## Content and relationships

Content uses a unified `content` table plus a `content_relationships` junction table;
helpers live in `src/lib/contentNode.js` and `src/lib/contentRelationships.js`.
