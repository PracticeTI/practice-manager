import { NextResponse } from 'next/server'
import { readdir } from 'fs/promises'
import path from 'path'
import { requestAiChatCompletion } from '@/lib/openaiClient'
import { resolveAiChatConfig } from '@/lib/ai/serverConfig'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.avif'])

/**
 * Derive a human-readable company name from a filename.
 * e.g. "acme-corp.svg" → "Acme Corp", "my_company.png" → "My Company"
 */
function nameFromFilename(filename) {
    const base = path.basename(filename, path.extname(filename))
    return base
        .replace(/[-_]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase())
}

function normalizeHref(value) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) return `https://www.${raw.replace(/^www\./i, '')}`
    return ''
}

function domainSlugFromName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}

function buildFallbackHref(name) {
    const slug = domainSlugFromName(name)
    if (!slug) return ''
    return `https://www.${slug}.com`
}

/**
 * POST /api/openai/logo-marquee-smart
 * Body: { folder: "/employers/acme" }
 * Returns: { items: [{ name, filePath, href }] }
 */
export async function POST(request) {
    try {
        const aiConfig = await resolveAiChatConfig()
        if (!aiConfig.hasApiKey) {
            return NextResponse.json(
                { error: `${aiConfig.providerLabel} API key not configured` },
                { status: 400 }
            )
        }

        const body = await request.json().catch(() => ({}))
        const rawFolder = typeof body?.folder === 'string' ? body.folder.trim() : ''
        if (!rawFolder) {
            return NextResponse.json({ error: 'folder is required' }, { status: 400 })
        }

        // Normalise: strip leading slash, prevent path traversal
        const cleanFolder = rawFolder.replace(/^\/+/, '').replace(/\.\./g, '')
        const publicDir = path.join(process.cwd(), 'public', cleanFolder)

        let files
        try {
            const entries = await readdir(publicDir, { withFileTypes: true })
            files = entries
                .filter((e) => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
                .map((e) => e.name)
        } catch {
            return NextResponse.json(
                { error: `Could not read folder: /${cleanFolder}` },
                { status: 400 }
            )
        }

        if (files.length === 0) {
            return NextResponse.json({ items: [] })
        }

        const names = files.map(nameFromFilename)

        // Ask the configured AI provider to guess the most likely homepage URL for each company name
        const prompt = `You are a company domain lookup tool. For each company name below, return the most likely real-world primary homepage URL in https://www.example.com format. Always provide your best guess (it is okay if some are imperfect). Use your knowledge of well-known companies — for example "Asana" → "https://www.asana.com", "Commonwealth Bank" → "https://www.commbank.com.au", "Nike" → "https://www.nike.com".

    If uncertain, still provide the most plausible URL candidate instead of leaving it blank.

Return ONLY a JSON array of objects with "name" and "href" keys, in the same order as the input list.

Companies:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Return format (example):
[
  { "name": "Asana", "href": "https://www.asana.com" },
    { "name": "Unknown Co", "href": "https://www.unknownco.com" }
]`

        const completion = await requestAiChatCompletion({
            ...aiConfig,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            maxOutputTokens: 600
        })

        let aiItems = files.map((file, i) => ({
            name: names[i],
            filePath: `/${cleanFolder}/${file}`,
            imageUrl: '',
            href: buildFallbackHref(names[i])
        }))

        if (completion.ok) {
            try {
                let content = String(completion.text || '').trim()
                if (content.startsWith('```')) {
                    content = content.replace(/^```[a-z]*\n?/, '').replace(/\n?```\s*$/, '')
                }
                const parsed = JSON.parse(content)
                if (Array.isArray(parsed)) {
                    aiItems = files.map((file, i) => {
                        const resolvedName = parsed[i]?.name || names[i]
                        const aiHref = normalizeHref(parsed[i]?.href)
                        return {
                            name: resolvedName,
                            filePath: `/${cleanFolder}/${file}`,
                            imageUrl: '',
                            href: aiHref || buildFallbackHref(resolvedName)
                        }
                    })
                }
            } catch {
                // Fall back to items without hrefs — already set above
            }
        }

        return NextResponse.json({ items: aiItems })
    } catch (err) {
        console.error('[logo-marquee-smart]', err)
        return NextResponse.json({ error: err?.message || 'Unexpected error' }, { status: 500 })
    }
}
