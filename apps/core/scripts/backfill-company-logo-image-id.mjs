import fs from 'fs'
import path from 'path'
import { Client } from 'pg'

function parseEnvFile(filePath) {
    const env = {}
    if (!fs.existsSync(filePath)) return env

    const raw = fs.readFileSync(filePath, 'utf8')
    raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return
        const eq = trimmed.indexOf('=')
        if (eq <= 0) return
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        env[key] = value
    })

    return env
}

function toObject(value, fallback = {}) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
        } catch {
            return fallback
        }
    }
    return fallback
}

async function main() {
    const apply = process.argv.includes('--apply')
    const workspaceRoot = path.resolve(process.cwd())
    const envPath = path.join(workspaceRoot, '.env.local')
    const envFromFile = parseEnvFile(envPath)
    const databaseUrl = process.env.DATABASE_URL || envFromFile.DATABASE_URL

    if (!databaseUrl) {
        throw new Error('DATABASE_URL not found (env or .env.local)')
    }

    const client = new Client({ connectionString: databaseUrl })
    await client.connect()

    try {
        const query = `
      SELECT
        c.id AS company_id,
        c.attributes AS company_attributes,
        lr.target_id AS logo_image_id
      FROM content c
      LEFT JOIN LATERAL (
        SELECT cr.target_id
        FROM content_relationships cr
        WHERE cr.source_id = c.id
          AND cr.relationship_type = 'logo'
        ORDER BY cr.created_at DESC NULLS LAST, cr.id DESC
        LIMIT 1
      ) lr ON true
      WHERE c.type = 'company'
      ORDER BY c.id ASC
    `

        const { rows } = await client.query(query)

        let inspected = 0
        let candidates = 0
        let updated = 0

        for (const row of rows) {
            inspected += 1
            const companyId = Number(row.company_id)
            const logoImageId = Number(row.logo_image_id)

            if (!Number.isFinite(logoImageId) || logoImageId <= 0) continue
            candidates += 1

            const attributes = toObject(row.company_attributes, {})
            const currentLogoId = Number(attributes.logo_image_id)

            if (Number.isFinite(currentLogoId) && currentLogoId === logoImageId) {
                continue
            }

            const nextAttributes = {
                ...attributes,
                logo_image_id: logoImageId
            }

            if (apply) {
                await client.query(
                    `UPDATE content SET attributes = $1::jsonb, updated_at = NOW() WHERE id = $2`,
                    [JSON.stringify(nextAttributes), companyId]
                )
            }

            updated += 1
            const actionLabel = apply ? 'updated' : 'would_update'
            console.log(`${actionLabel}: company ${companyId} -> logo_image_id ${logoImageId}`)
        }

        console.log(JSON.stringify({
            mode: apply ? 'apply' : 'dry-run',
            inspected,
            candidates,
            updated
        }, null, 2))
    } finally {
        await client.end()
    }
}

main().catch((error) => {
    console.error(error.message || error)
    process.exit(1)
})
