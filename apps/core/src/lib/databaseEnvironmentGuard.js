/**
 * Refuse to serve a deployment from the wrong database.
 *
 * Vercel applies environment variables per environment, but a variable scoped to
 * "All Environments" silently gives preview the production database. That happened
 * here: preview ran table initialisers and migrations against production, and for a
 * period those migration routes were callable without a token. Every such mistake
 * looked like a working deployment.
 *
 * The check keys on a declared value rather than trying to infer anything from the
 * connection string, because "is this host production?" is not answerable reliably
 * from a URL.
 *
 *   DATABASE_ENVIRONMENT=production|preview|development|test
 *
 * Unset or unrecognised means "no claim", and the guard stays dormant so adding it
 * cannot break an existing deployment.
 */

export const DATABASE_ENVIRONMENTS = ['production', 'preview', 'development', 'test']

function normalize(value) {
    return String(value || '').trim().toLowerCase()
}

/** Declared database environment, or null when the deployment makes no claim. */
export function resolveDatabaseEnvironment(env = process.env) {
    const declared = normalize(env.DATABASE_ENVIRONMENT)
    return DATABASE_ENVIRONMENTS.includes(declared) ? declared : null
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ allowed: boolean, reason?: string, message?: string, deployment?: string|null, database?: string|null }}
 */
export function checkDatabaseEnvironment(env = process.env) {
    const deployment = normalize(env.VERCEL_ENV) || null
    const database = resolveDatabaseEnvironment(env)

    if (!deployment || !database) {
        return { allowed: true, deployment, database }
    }

    if (database === 'production' && deployment !== 'production') {
        if (env.ALLOW_PRODUCTION_DATABASE_IN_PREVIEW === '1') {
            return { allowed: true, deployment, database }
        }

        return {
            allowed: false,
            deployment,
            database,
            reason: 'preview-using-production-database',
            message:
                `Refusing to connect: this ${deployment} deployment has DATABASE_ENVIRONMENT=production. ` +
                'Point the preview environment at its own database, or set ' +
                'ALLOW_PRODUCTION_DATABASE_IN_PREVIEW=1 for a one-off check against production data.',
        }
    }

    if (deployment === 'production' && database !== 'production') {
        return {
            allowed: false,
            deployment,
            database,
            reason: 'production-using-non-production-database',
            message:
                `Refusing to start: this production deployment has DATABASE_ENVIRONMENT=${database}. ` +
                'Production must not serve from a non-production database.',
        }
    }

    return { allowed: true, deployment, database }
}

/** Throwing form used at the connection funnel. */
export function assertDatabaseEnvironment(env = process.env) {
    const result = checkDatabaseEnvironment(env)
    if (!result.allowed) {
        throw new Error(`[database-guard] ${result.message}`)
    }
    return result
}
