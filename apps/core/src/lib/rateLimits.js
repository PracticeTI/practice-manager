// Fixed-window rate limiting for unauthenticated endpoints.
//
// Public booking and public intake both need a per-IP cap, and a serverless
// deployment cannot hold counters in memory, so one shared table backs both.
// A single upsert makes the increment atomic across instances.

export const RATE_LIMIT_TABLE = 'api_rate_limits'

let ensurePromise = null

export async function ensureRateLimitTable(connection) {
    if (!connection?.query) return
    if (!ensurePromise) {
        ensurePromise = connection.query(`
            CREATE TABLE IF NOT EXISTS ${RATE_LIMIT_TABLE} (
                bucket_key VARCHAR(200) PRIMARY KEY,
                window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                request_count INTEGER NOT NULL DEFAULT 0
            )
        `).catch((error) => {
            ensurePromise = null
            throw error
        })
    }
    await ensurePromise
}

/**
 * Count one hit against a bucket and report whether it is still allowed.
 *
 * @param {object} connection  PostgreSQL connection
 * @param {object} options
 * @param {string} options.bucketKey   unique key, e.g. `booking:acme:1.2.3.4`
 * @param {number} options.limit       allowed hits per window
 * @param {number} options.windowSeconds window length
 */
export async function consumeRateLimit(connection, { bucketKey, limit, windowSeconds }) {
    await ensureRateLimitTable(connection)

    const result = await connection.query(
        `INSERT INTO ${RATE_LIMIT_TABLE} (bucket_key, window_started_at, request_count)
         VALUES ($1, NOW(), 1)
         ON CONFLICT (bucket_key) DO UPDATE SET
             request_count = CASE
                 WHEN ${RATE_LIMIT_TABLE}.window_started_at < NOW() - make_interval(secs => $2) THEN 1
                 ELSE ${RATE_LIMIT_TABLE}.request_count + 1
             END,
             window_started_at = CASE
                 WHEN ${RATE_LIMIT_TABLE}.window_started_at < NOW() - make_interval(secs => $2) THEN NOW()
                 ELSE ${RATE_LIMIT_TABLE}.window_started_at
             END
         RETURNING request_count`,
        [String(bucketKey || '').trim().slice(0, 200), Math.max(1, Number(windowSeconds) || 60)]
    )

    const count = Number(result.rows?.[0]?.request_count || 0)
    const safeLimit = Math.max(1, Number(limit) || 1)
    return { allowed: count <= safeLimit, count, remaining: Math.max(0, safeLimit - count) }
}

/** Best-effort client IP for per-visitor buckets. */
export function clientIp(request) {
    const forwarded = request.headers.get('x-forwarded-for') || ''
    const first = forwarded.split(',')[0].trim()
    if (first) return first
    return String(request.headers.get('x-real-ip') || '').trim() || 'unknown'
}
