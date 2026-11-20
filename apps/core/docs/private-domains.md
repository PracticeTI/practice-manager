# Private domain overlay

The open-source distribution of this app ships only the unbranded `default` domain.
Branded domain routes, configuration, design tokens and assets live in a **separate
overlay tree**, supplied to the build by an operator (see [Hosted builds](#hosted-builds)).

The public runtime registry does not name customer domains. Everything the core needs to know
about one arrives through [`src/lib/domainExtension.js`](../src/lib/domainExtension.js), which
reads a generated `src/lib/privateDomains.js`.

## Public default

`CORE_DOMAIN_MODES` in [`src/lib/domainMode.js`](../src/lib/domainMode.js) lists the domains the
public tree ships. It contains only `default`. Builds with the overlay may set one descriptor's
`defaultDomain` flag; otherwise `DEFAULT_DOMAIN_MODE` falls back to `default`. A descriptor may
also set `defaultContentDomain` when the domain that owns shared content differs from the active
default site mode.

| Domain | Hostnames | Role |
|--------|-----------|------|
| `default` | No built-in hostname | Unbranded public fallback |

Domain-specific configuration belongs in the overlay descriptor. The core reads hostnames,
labels, landing routes, shared-root behavior, metadata and styles through
[`src/lib/domainExtension.js`](../src/lib/domainExtension.js); do not add customer modes or
branding to the public registry.

## How it works

```
src/private/                     optional overlay checkout (absent in a public tree)
└── overlay/
    ├── app/          copied into src/app        (routes + API routes)
    ├── components/   copied into src/components
    ├── lib/          copied into src/lib
    │   ├── privateDomains.data.js   domain descriptors (pure data)
    │   └── landings.json            domain -> landing component specifier
    ├── tailwind/     inlined into tailwind.private.cjs (theme extensions)
    ├── test/         copied into test
    ├── scripts/      copied into scripts
    ├── public/       copied into public        (every asset: the core tracks none)
    ├── content/      copied into content        (report templates)
    └── docs/         copied into docs
```

[`scripts/sync-private-overlay.mjs`](../scripts/sync-private-overlay.mjs) runs on
`postinstall`, `predev`, `prebuild`, `prelint` and `pretest`:

1. removes the files the previous run copied (recorded in `.private-overlay.json`);
2. copies every overlay directory into the matching project directory;
3. regenerates `src/lib/privateDomains.js`, `src/components/privateLandings.jsx`,
   `src/app/private-overlay-sources.css` and `tailwind.private.cjs` (theme extensions such as
   brand colours).

When `src/private` is absent the script writes **empty stubs**, so the app builds and runs as a
plain public deployment with only the unbranded default domain.

Copied files, the manifest, and the generated modules are gitignored, so private code can never
be committed here by accident.

### Why the overlay needs explicit Tailwind sources

Tailwind v4's automatic source detection honours `.gitignore`, and every overlay copy is
gitignored. Overlay markup was therefore only scanned when the overlay's own tree sat inside the
project (`src/private/overlay`); a hosted build that mounts it elsewhere — a shallow clone in
`.private-overlay-src`, or a `PRIVATE_OVERLAY_DIR` outside the checkout — still built the routes
but shipped them **without the overlay's utility classes**, so branded pages lost their layout on
that host alone while local `npm run dev` looked correct.

[`src/app/globals.css`](../src/app/globals.css) imports the generated
`src/app/private-overlay-sources.css`, which holds one `@source` line per mounted markup file.
Explicit `@source` entries are not filtered by the ignore rules. They are written per file rather
than per directory because a directory source only reaches gitignored children when the directory
itself is gitignored.

## Commands

| Command | Effect |
|---------|--------|
| `npm run private:sync` | Mount the overlay (no-op when the submodule is absent) |
| `npm run private:clean` | Unmount it and regenerate empty stubs |
| `npm run private:check` | Exit non-zero if private files remain in the tree |
| `npm run private:guard` | Exit non-zero if a private file is tracked or would be pushed |

Run `private:clean` and `private:check` before publishing anything from this repository.

### Keeping the copies out of this repository

`npm run private:sync` writes the overlay into the public layout, so during development each
private file exists twice: once in `src/private/overlay/` (the source of truth) and once at its
public path (a working copy that Next.js can build). Nothing is symlinked — the script copies
files, and `.gitignore` lists every destination it writes, which is why the copies never reach
this repository.

Two guards enforce that, both running [`scripts/check-private-files.mjs`](../scripts/check-private-files.mjs):

| Guard | Where | Catches |
|-------|-------|---------|
| Pre-push hook | `.githooks/pre-push`, installed by `npm install` (`prepare` sets `core.hooksPath`) | A pushed commit that adds a path the last mount produced (read from `.private-overlay.json`), and an overlay destination `.gitignore` does not exclude (read from `src/private/overlay`) |
| `Private overlay` job in [ci.yml](../../../.github/workflows/ci.yml), plus a step in the `Lint` job of [release.yml](../../../.github/workflows/release.yml) | CI, on every pull request and every push to `preview` | Any tracked file that `.gitignore` excludes — i.e. an overlay copy that was committed |

CI has no private submodule, so it sees only the ignore rules; the hook additionally knows the
exact paths the overlay produced and the folders it is about to produce. Adding a domain folder
to the private repository therefore fails the next push until `.gitignore` lists it, instead of
silently creating a new gap. Neither guard needs the private repository to run in CI.

Because the working copies are just copies, they are disposable: deleting `public/` or
`src/app/<domain>/` costs nothing, and `npm run private:sync` recreates them byte for byte.
`public/` is the extreme case: this repository tracks no file under it at all, so a clean
checkout has no `public/` directory and every asset arrives with the overlay.

## The extension contract

Core code asks the extension layer questions; it never tests for a literal domain.

```js
import { getPrivateDomainModes, hasPrivateDomainTrait } from '@/lib/domainExtension'

VALID_DOMAIN_MODES          // CORE_DOMAIN_MODES + getPrivateDomainModes()
getPrivateHostnameMap()     // hostname -> mode, merged over the core map
getPrivateDomainLabels()    // display labels
getPrivateBrandIconSets()   // favicon / mask-icon sets
getPrivateSeoPresets()      // default SEO per domain
getPrivateDomainFieldMap(field)  // { [mode]: descriptor[field] } escape hatch
getPrivateDomainBrandMark(mode)  // admin header brand lockup override
hasPrivateDomainTrait(mode, trait)
getPrivateContentTypeOwner(type)
getPrivateHomepageScopes()
getPrivateFooterBrand()
getPrivatePublicApiRoutes()  // /api routes the overlay ships and declares session-free
```

The overlay documents every descriptor field it sets; see its own `README.md`.

### Adding a new domain-scoped behaviour

1. Add the field to the overlay's `privateDomains.data.js`.
2. Add a small accessor to `src/lib/domainExtension.js` that returns an empty value when the
   field is absent.
3. Consume the accessor from core code.
4. Add a test to the overlay's `overlay/test/` for the declared behaviour, and keep
   the core test using a core domain.

## Hosted builds

A hosted build only serves customer domains if it can see the overlay. The script resolves it in
this order, and the first source that exists wins:

| Order | Source | Use when |
|-------|--------|----------|
| 1 | `PRIVATE_OVERLAY_DIR` | The overlay is already on disk (mounted volume, CI checkout, container image) |
| 2 | `src/private/overlay` | The git submodule was cloned (local development, `actions/checkout` with `submodules: recursive`) |
| 3 | A shallow clone of the private repository | The host cannot clone submodules; needs `PRIVATE_OVERLAY_REPO_URL`/`.gitmodules` **and** `PRIVATE_OVERLAY_TOKEN` |

| Variable | Purpose |
|----------|---------|
| `PRIVATE_OVERLAY_DIR` | Path to an overlay tree (the directory holding `app/`, `lib/`, `public/`, …) |
| `PRIVATE_OVERLAY_REPO_URL` | Overlay repository URL; defaults to the `src/private` entry in `.gitmodules` |
| `PRIVATE_OVERLAY_REF` | Branch or tag to clone (defaults to the repository's default branch) |
| `PRIVATE_OVERLAY_TOKEN` | Token used for the clone. Falls back to `GITHUB_TOKEN`, then `GH_TOKEN` |
| `PRIVATE_OVERLAY_REQUIRED` | `1`/`true` makes a build with no overlay fail instead of emitting empty stubs |

**A build without the overlay still succeeds and looks healthy.** It writes the empty stubs, so
`VALID_DOMAIN_MODES` contains only the core domains, the overlay routes and assets are absent, and
[`detectDomainFromHostname`](../src/lib/domainMode.js) returns `null` for every customer hostname.
Those hosts then fall through to `DEFAULT_DOMAIN_MODE` and render the default domain's site under
the customer's domain, and nothing fails.

Set `PRIVATE_OVERLAY_REQUIRED=1` on every deployment that must serve customer domains so this
regression fails the build instead of reaching production:

```bash
# Vercel project → Settings → Environment Variables (Production + Preview)
PRIVATE_OVERLAY_REQUIRED=1
PRIVATE_OVERLAY_TOKEN=<GitHub token with read access to the overlay repository>
```

With a token set, the build clones the overlay itself and does not depend on Vercel's submodule
support. Alternatively, grant the Vercel GitHub app access to the overlay repository so the
submodule clones normally, and keep `PRIVATE_OVERLAY_REQUIRED=1` as the guard.

### Troubleshooting the overlay token

A bad token surfaces as `could not clone the private overlay repository: …` during
`postinstall`, so the whole build stops after a few seconds.

| Git error | Meaning |
|-----------|---------|
| `Write access to repository not granted` | The token cannot see the repository **at all**. Write access is *not* required — this is GitHub's generic 403 for "no access". |
| `Invalid username or token` | The token value is wrong, expired, or revoked. |
| `Repository not found` | The URL is wrong, or the token is scoped to the wrong resource owner. |

For a fine-grained token, all four of these must hold:

1. **Resource owner** is the organisation that owns the overlay repository, not your personal
   account. With the wrong owner the repository never appears in the selection list.
2. **Repository access** is *Only select repositories*, with the overlay repository selected.
3. **Repository permissions → Contents** is *Read-only*. (`Metadata` follows automatically. No
   other repository permission and no account permission is involved.)
4. The organisation has not left the token **pending approval**, and does not block fine-grained
   tokens. If it blocks them, use a classic token with the `repo` scope instead — `repo` also
   implies write, which is harmless for a clone.

Test a token before adding it to the host, so a bad token does not cost a build cycle:

```bash
read -rsp 'PAT: ' TOK && echo
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=http.https://github.com/.extraheader \
GIT_CONFIG_VALUE_0="Authorization: Basic $(printf 'x-access-token:%s' "$TOK" | base64)" \
GIT_TERMINAL_PROMPT=0 git ls-remote <overlay-repo-url> HEAD
```

A commit SHA means the token can read the repository. Variables marked *Sensitive* in Vercel are
written as `[SENSITIVE]` by `vercel env pull`, so this local check is the only way to test one
without redeploying.

### Verifying a hosted build

1. `GET /api/<customer-domain>/...` (any overlay API route) must not return `404`.
2. A brand asset under `public/<customer-domain>/` must not return `404`.
3. `curl -s https://<customer-domain>/ | grep -o '<title>[^<]*</title>'` must show that domain's
   title, not the default domain's.
4. The response's `x-matched-path` header for `/` should name the domain's landing route when the
   descriptor sets `exactRoute`.

A preview deployment sits behind Vercel Deployment Protection, so plain `curl` gets a `302` to
`vercel.com/sso-api` instead of the page. Run these checks against a production host, or send the
protection bypass secret:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  https://<deployment-url>/
```

## Verification

```bash
npm run private:clean && npm run lint && npm test && npm run build   # public tree
npm run private:sync  && npm run lint && npm test && npm run build   # full private tree
```

Both must pass. The route table in the build output is the quickest way to confirm the split:
the clean build has no `/<customer-domain>` routes, and the mounted build has exactly the ones
the overlay declares.
