import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'

async function inspectIdConfig(conn) {
    const defaultResult = await conn.query(`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'content'
      AND column_name = 'id'
    LIMIT 1
  `)

    const sequenceResult = await conn.query(
        `SELECT pg_get_serial_sequence('content', 'id') AS seq_name`
    )

    const maxIdResult = await conn.query(
        `SELECT COALESCE(MAX(id), 0) AS max_id FROM content`
    )

    const columnDefault = defaultResult.rows?.[0]?.column_default || null
    const sequenceName = sequenceResult.rows?.[0]?.seq_name || null
    const maxId = Number(maxIdResult.rows?.[0]?.max_id || 0)

    return {
        columnDefault,
        sequenceName,
        maxId,
        healthy: Boolean(sequenceName && columnDefault && columnDefault.includes('nextval'))
    }
}

/**
 * GET /api/database/fix-content-id-sequence
 * Diagnose content.id default/sequence state
 */
export async function GET() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json(
            { success: false, error: 'PostgreSQL required' },
            { status: 400 }
        )
    }

    let conn
    try {
        conn = await getDatabaseConnection()
        const status = await inspectIdConfig(conn)

        return NextResponse.json({
            success: true,
            ...status
        })
    } catch (error) {
        console.error('Failed to inspect content.id sequence:', error)
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        )
    } finally {
        if (conn?.end) {
            await conn.end().catch(() => { })
        }
    }
}

/**
 * POST /api/database/fix-content-id-sequence
 * Repair content.id default/sequence and sync to MAX(id)
 */
export async function POST() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json(
            { success: false, error: 'PostgreSQL required' },
            { status: 400 }
        )
    }

    let conn
    try {
        conn = await getDatabaseConnection()
        await conn.query('BEGIN')

        const before = await inspectIdConfig(conn)

        let sequenceName = before.sequenceName
        if (!sequenceName) {
            await conn.query(`CREATE SEQUENCE IF NOT EXISTS content_id_seq`)
            await conn.query(`ALTER SEQUENCE content_id_seq OWNED BY content.id`)
            await conn.query(`ALTER TABLE content ALTER COLUMN id SET DEFAULT nextval('content_id_seq'::regclass)`)
            sequenceName = 'public.content_id_seq'
        }

        await conn.query(
            `SELECT setval($1::regclass, GREATEST(COALESCE((SELECT MAX(id) FROM content), 0), 1), true)`,
            [sequenceName]
        )

        const after = await inspectIdConfig(conn)
        await conn.query('COMMIT')

        return NextResponse.json({
            success: true,
            message: 'content.id sequence/default repaired',
            before,
            after
        })
    } catch (error) {
        if (conn) {
            await conn.query('ROLLBACK').catch(() => { })
        }
        console.error('Failed to repair content.id sequence:', error)
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        )
    } finally {
        if (conn?.end) {
            await conn.end().catch(() => { })
        }
    }
}
