import { NextResponse } from 'next/server'
import { getDatabaseConnection } from '@/lib/database'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { ensurePatientFilesTable } from '@/lib/patientFilesTable'
import { FileStorageError, readStoredFile } from '@/lib/fileStore'
import {
    extractAttachmentText,
    ATTACHMENT_TEXT_EMPTY,
    ATTACHMENT_TEXT_UNREADABLE,
    ATTACHMENT_TEXT_UNSUPPORTED,
} from '@/lib/attachmentText'

export const runtime = 'nodejs'

function parseInteger(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
}

async function resolveRouteParams(params) {
    return params && typeof params.then === 'function' ? await params : (params || {})
}

async function resolveRequestContext(request, requestedDomain) {
    const authHeader = request.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return { error: 'Missing Authorization header', status: 401 }
    const user = await verifyAdminToken(authHeader.slice('Bearer '.length).trim())
    if (!user) return { error: 'Invalid auth token', status: 401 }
    const superadmin = isSuperAdmin(user)
    const userDomain = normalizeDomain(user?.domain)
    if (!superadmin && userDomain) {
        if (requestedDomain && requestedDomain !== userDomain) return { error: 'Forbidden: domain scope mismatch', status: 403 }
        return { domain: userDomain, role: 'admin' }
    }
    if (!superadmin) return { error: 'Forbidden: admin domain is required', status: 403 }
    if (!requestedDomain) return { error: 'domain is required', status: 400 }
    return { domain: requestedDomain, role: 'superadmin' }
}

/**
 * Returns the text of a stored patient file so the FCA builder can add it to
 * the report context.
 *
 * Text-like files, DOCX and PDFs are supported; images, recordings and scanned
 * PDFs with no text layer answer with `unsupported: true` and are attached by
 * name only.
 */
export async function GET(request, { params }) {
    const routeParams = await resolveRouteParams(params)
    const id = parseInteger(routeParams.id)
    const { searchParams } = new URL(request.url)
    const context = await resolveRequestContext(request, normalizeDomain(searchParams.get('domain')))
    if (context.error) return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    if (!id) return NextResponse.json({ success: false, error: 'Invalid file id' }, { status: 400 })

    let connection = null
    try {
        await ensurePatientFilesTable()
        connection = await getDatabaseConnection()
        const stored = await readStoredFile({ connection, context, fileId: id })
        if (!stored) return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })

        const extraction = await extractAttachmentText({
            mimeType: stored.row.mime_type,
            fileName: stored.row.file_name,
            buffer: stored.buffer,
        })

        if (extraction.status === ATTACHMENT_TEXT_UNSUPPORTED) {
            return NextResponse.json(
                { success: false, unsupported: true, error: extraction.error },
                { status: 415 }
            )
        }

        if (extraction.status === ATTACHMENT_TEXT_EMPTY) {
            return NextResponse.json({ success: false, error: extraction.error }, { status: 422 })
        }

        if (extraction.status === ATTACHMENT_TEXT_UNREADABLE) {
            // A corrupt DOCX is a bad file, not a server fault: report it as an unprocessable
            // attachment rather than letting the error surface as a 500.
            return NextResponse.json({ success: false, error: extraction.error }, { status: 422 })
        }

        return NextResponse.json({
            success: true,
            data: {
                id: stored.row.id,
                fileName: stored.row.file_name,
                mimeType: stored.row.mime_type,
                source: extraction.source,
                truncated: extraction.truncated,
                text: extraction.text,
            },
        })
    } catch (error) {
        const status = error instanceof FileStorageError ? error.status : 500
        return NextResponse.json({ success: false, error: error?.message || 'Failed to read patient file' }, { status })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
