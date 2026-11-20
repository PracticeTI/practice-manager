import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { normalizeDomainKey } from '@/lib/templateLibrary'
import {
    collectMarkdownFiles,
    getTemplateLibraryDirectory,
} from '@/lib/templateLibraryServer'

function getAdminTokenFromRequest(request) {
    const authHeader = request.headers.get('authorization') || ''
    return authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
}

export async function GET(request) {
    try {
        const adminUser = await verifyAdminToken(getAdminTokenFromRequest(request))
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const domain = normalizeDomainKey(searchParams.get('domain'))
        if (!domain) {
            return NextResponse.json({ error: 'domain is required' }, { status: 400 })
        }
        if (!isSuperAdmin(adminUser) && normalizeDomainKey(adminUser?.domain) !== domain) {
            return NextResponse.json({ error: 'Forbidden: cannot load requested domain' }, { status: 403 })
        }

        const { directory, path: resolvedPath, source, configuredPath } = await getTemplateLibraryDirectory(domain)

        if (configuredPath && !directory) {
            return NextResponse.json({ error: 'Template Library path must be inside the content directory' }, { status: 400 })
        }
        if (!directory) {
            return NextResponse.json({ success: true, domain, path: '', files: [], source })
        }

        const files = (await collectMarkdownFiles(directory))
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath))

        return NextResponse.json({ success: true, domain, path: resolvedPath, files, source })
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return NextResponse.json({ error: 'Template Library directory was not found' }, { status: 404 })
        }
        return NextResponse.json({ error: error?.message || 'Failed to load Template Library' }, { status: 500 })
    }
}