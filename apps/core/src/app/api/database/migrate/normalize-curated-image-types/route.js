import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

function parseMetadata(value) {
    if (!value) return {}
    if (typeof value === 'object') return value
    if (typeof value === 'string') {
        try {
            return JSON.parse(value)
        } catch {
            return {}
        }
    }
    return {}
}

function normalizeCategory(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/-/g, '_')

    if (!normalized) return null
    if (normalized === 'general' || normalized === 'key_art' || normalized === 'keyart') return 'key_art'
    if (normalized === 'actor' || normalized === 'actors') return 'actor'
    if (normalized === 'company' || normalized === 'companies') return 'company'
    return normalized
}

function toDisplayCategory(category) {
    if (category === 'key_art') return 'Key Art'
    if (category === 'actor') return 'Actor'
    if (category === 'company') return 'Company'
    return category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Key Art'
}

function inferCategory({ rowType, metadata, rowName, rowTitle, recategorizeByHeuristics = false }) {
    const fromImageCategory = normalizeCategory(metadata?.image_category)
    const fromCategory = normalizeCategory(metadata?.category)

    const candidateTitle = String(rowTitle || rowName || metadata?.title || '').toLowerCase()
    const searchPhrase = String(metadata?.search_phrase || '').trim()
    const normalizedPhrase = searchPhrase.toLowerCase()

    if (recategorizeByHeuristics) {
        const maybeCompany = /(^|\s)(logo|studios?|pictures?|network|media|entertainment)(\s|$)/.test(candidateTitle)
        if (maybeCompany) {
            return 'company'
        }

        const looksLikePersonName =
            searchPhrase &&
            normalizedPhrase !== 'custom url' &&
            /^[a-zA-Z .'-]+$/.test(searchPhrase) &&
            searchPhrase.trim().split(/\s+/).length >= 2 &&
            searchPhrase.trim().split(/\s+/).length <= 4

        if (looksLikePersonName) {
            return 'actor'
        }
    }

    if (fromImageCategory) return fromImageCategory
    if (fromCategory) return fromCategory

    const typeCategory = normalizeCategory(rowType)
    if (typeCategory) return typeCategory

    return 'key_art'
}

async function selectCandidateRows(connection) {
    const result = await connection.query(
        `SELECT id, type, subtype, name, title, metadata
       FROM content
       WHERE subtype = $1`,
        ['image']
    )
    return result.rows || []
}

async function updateRow(connection, { id, metadata }) {
    const payload = JSON.stringify(metadata)

    await connection.query(
        `UPDATE content
       SET type = $1,
           subtype = $2,
           metadata = $3,
           updated_at = NOW()
       WHERE id = $4`,
        ['image', 'image', payload, id]
    )
}

/**
 * POST /api/database/migrate/normalize-curated-image-types
 * Body: { dryRun?: boolean }
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
    let connection
    try {
        const body = await request.json().catch(() => ({}))
        const dryRun = body?.dryRun !== false
        const recategorizeByHeuristics = body?.recategorizeByHeuristics === true

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json(
                { success: false, error: 'Relational database (PostgreSQL) is required' },
                { status: 400 }
            )
        }

        connection = await getDatabaseConnection()
        const rows = await selectCandidateRows(connection)

        let updated = 0
        let alreadyCanonical = 0
        const changedIds = []

        for (const row of rows) {
            const metadata = parseMetadata(row.metadata)
            const canonicalCategory = inferCategory({
                rowType: row.type,
                metadata,
                rowName: row.name,
                rowTitle: row.title,
                recategorizeByHeuristics
            })
            const nextMetadata = {
                ...metadata,
                category: toDisplayCategory(canonicalCategory),
                image_category: canonicalCategory
            }

            const metadataChanged = JSON.stringify(metadata) !== JSON.stringify(nextMetadata)
            const typeChanged = String(row.type || '').toLowerCase() !== 'image'
            const subtypeChanged = String(row.subtype || '').toLowerCase() !== 'image'
            const needsUpdate = metadataChanged || typeChanged || subtypeChanged

            if (!needsUpdate) {
                alreadyCanonical += 1
                continue
            }

            if (!dryRun) {
                await updateRow(connection, {
                    id: row.id,
                    metadata: nextMetadata
                })
            }

            updated += 1
            changedIds.push(row.id)
        }

        return NextResponse.json({
            success: true,
            dryRun,
            recategorizeByHeuristics,
            scanned: rows.length,
            updated,
            alreadyCanonical,
            changedIds
        })
    } catch (error) {
        console.error('Error normalizing curated image content types:', error)
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to normalize curated image content types' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
