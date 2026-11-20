// Developer-only tooling that cannot work on a managed host.
//
// Provider hero capture shells out to a local Chrome install, and "approve" writes
// approved PNGs into public/. That filesystem is read-only on Vercel and ephemeral
// on Cloud Run, so the whole workflow is a commit-from-a-workstation one. The API
// and the admin entry points are gated on this rule so production never offers a
// button that cannot work.
//
// Client-safe: no server-only imports, so the admin UI shares the same decision as
// the route handlers.

export function isDevToolingEnabled() {
    return process.env.NODE_ENV !== 'production'
}

export const DEV_TOOLING_DISABLED_MESSAGE =
    'Provider hero capture is a developer-only tool: it needs a local Chrome install and writes approved captures into public/. It is disabled in production.'
