import { NextResponse } from 'next/server'
import { DEFAULT_CONTENT_DOMAIN } from '@/lib/domainMode'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { buildNodeResponse } from '@/lib/contentNode'
import { generateWebSearch } from '@/lib/ai/webSearch'

export const maxDuration = 60

const CATEGORY_KEY = 'industry_news'
const CATEGORY_LABEL = 'Industry News'
const DEFAULT_TOPIC = 'Small Business Operations'
const DEFAULT_TTL_DAYS = 3
const PENDING_DELETE_STATUS = 'pending delete'

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
}

function extractSiteLabel(url) {
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '')
        const base = hostname.split('.')[0]
        return base.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    } catch {
        return 'Source'
    }
}

function extractPublisherDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '')
    } catch {
        return null
    }
}

function isArticleStale(row) {
    if (!row) return true

    let ttlDays = DEFAULT_TTL_DAYS
    try {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {})
        const stored = Number(meta.ttl_days)
        if (stored > 0) ttlDays = stored
    } catch {
        // use default TTL
    }

    const createdAt = new Date(row.created_at).getTime()
    if (!Number.isFinite(createdAt)) return true

    // Require at least 3 sources on cached rows so older low-citation entries refresh.
    try {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {})
        const sourceCount = Array.isArray(meta?.sources)
            ? meta.sources.filter((source) => typeof source?.url === 'string' && source.url.trim()).length
            : 0
        if (sourceCount < 3) return true
    } catch {
        return true
    }

    const expiresAt = createdAt + ttlDays * 24 * 60 * 60 * 1000
    return Date.now() > expiresAt
}

function normalizeTopic(value) {
    const topic = String(value || '').trim()
    return topic || DEFAULT_TOPIC
}

async function fetchMostRecentIndustryNews(connection, domain, topic) {
    const normalizedDomain = String(domain || DEFAULT_CONTENT_DOMAIN).trim().toLowerCase() || DEFAULT_CONTENT_DOMAIN
    const normalizedTopic = String(topic || '').trim().toLowerCase()

    const result = await connection.query(
        `SELECT * FROM content
       WHERE LOWER(type) IN ('post', 'article')
         AND LOWER(COALESCE(attributes->>'domain', metadata->>'domain', '')) = $2
         AND LOWER(COALESCE(attributes->>'category', metadata->>'category', '')) = $1
         AND LOWER(COALESCE(attributes->>'topic', metadata->>'topic', '')) = $3
       ORDER BY created_at DESC
       LIMIT 1`,
        [CATEGORY_KEY, normalizedDomain, normalizedTopic]
    )
    return result.rows[0] || null
}

async function generateIndustryNews(topic) {
    const normalizedTopic = normalizeTopic(topic)

    const prompt = [
        `Search for at least 3 recent real news articles from DIFFERENT publishers about this topic: ${normalizedTopic}.`,
        '',
        'Based on the real news you find, write a brief practice business-news article for small business owners and operators.',
        '',
        `Category: ${CATEGORY_LABEL}`,
        '',
        'Requirements:',
        '- Return ONLY valid JSON with exactly three keys: "title", "summary", and "sources".',
        '- title: 8-14 words, editorial headline style, no quotes or markdown.',
        '- summary: exactly 3 paragraphs, total 160-220 words, plain text only, grounded in real sources found.',
        '- Separate paragraphs with a single blank line (\\n\\n).',
        '- Each paragraph 2-4 sentences; clear and practical language.',
        '- sources: a JSON array of at least 3 objects from DIFFERENT publishers. Each object has "url" and "label".',
        '- Do not include markdown, bullets, or formatting marks in title or summary.'
    ].join('\n')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)

    try {
        const result = await generateWebSearch({
            query: prompt,
            system: 'You write concise, practical business-news summaries for a small-business CMS. Use the web search tool and base claims on real current sources.',
            signal: controller.signal,
        })

        if (!result.ok) {
            console.warn('Practice news generation failed:', result.error)
            return null
        }

        const rawContent = result.text
        const annotationSources = (result.sources || []).map((source) => ({
            url: source.url,
            label: source.title || extractSiteLabel(source.url),
        }))

        if (!rawContent) return null

        const stripped = rawContent
            .replace(/^```[a-zA-Z]*\s*/, '')
            .replace(/\s*```\s*$/, '')
            .trim()

        let parsed
        try {
            parsed = JSON.parse(stripped)
        } catch {
            const jsonMatch = stripped.match(/\{[\s\S]*\}/)
            if (!jsonMatch) return null
            try {
                parsed = JSON.parse(jsonMatch[0])
            } catch {
                return null
            }
        }

        const title = String(parsed?.title || '').trim()
        const summary = String(parsed?.summary || '').replace(/\r\n/g, '\n').trim()
        if (!title || !summary) return null

        let sources = []
        if (Array.isArray(parsed?.sources)) {
            const seenDomains = new Set()
            for (const source of parsed.sources) {
                if (typeof source?.url !== 'string' || !source.url) continue
                const domain = extractPublisherDomain(source.url)
                if (!domain || seenDomains.has(domain)) continue
                seenDomains.add(domain)
                sources.push({
                    url: String(source.url),
                    label: String(source?.label || extractSiteLabel(source.url))
                })
                if (sources.length >= 5) break
            }
        }

        if (sources.length < 3 && annotationSources.length > 0) {
            const seenUrls = new Set(sources.map((source) => source.url))
            const seenDomains = new Set(sources.map((source) => extractPublisherDomain(source.url)).filter(Boolean))

            for (const source of annotationSources) {
                if (sources.length >= 5) break
                const domain = extractPublisherDomain(source.url)
                if (seenUrls.has(source.url)) continue
                if (domain && seenDomains.has(domain)) continue
                sources.push(source)
                seenUrls.add(source.url)
                if (domain) seenDomains.add(domain)
            }
        }

        if (sources.length < 3) return null

        return { title, summary, sources }
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.warn('Practice industry news generation failed:', error?.message || error)
        }
        return null
    } finally {
        clearTimeout(timeout)
    }
}

async function insertIndustryNewsPost(connection, article, domain, topic) {
    const nowIso = new Date().toISOString()
    const normalizedDomain = String(domain || DEFAULT_CONTENT_DOMAIN).trim().toLowerCase() || DEFAULT_CONTENT_DOMAIN
    const normalizedTopic = normalizeTopic(topic)
    const baseSlug = slugify(article.title) || `${normalizedDomain}-industry-news`
    const slug = `${baseSlug}-${Date.now()}`

    const attributes = JSON.stringify({
        domain: normalizedDomain,
        category: CATEGORY_KEY,
        topic: normalizedTopic
    })

    const metadata = JSON.stringify({
        domain: normalizedDomain,
        category: CATEGORY_KEY,
        topic: normalizedTopic,
        presentation: {
            default: {
                title: article.title,
                summary: article.summary
            }
        },
        generated_at: nowIso,
        source: 'practice-news-auto',
        sources: Array.isArray(article.sources) ? article.sources : [],
        ttl_days: DEFAULT_TTL_DAYS
    })

    const archivePreviousRow = async (currentId) => {
        if (!currentId) return

        const archivedAt = new Date().toISOString()

        const previousResult = await connection.query(
            `SELECT id, metadata, status
             FROM content
             WHERE id <> $1
               AND LOWER(type) IN ('post', 'article')
               AND LOWER(COALESCE(attributes->>'domain', metadata->>'domain', '')) = $2
               AND LOWER(COALESCE(attributes->>'category', metadata->>'category', '')) = $3
               AND LOWER(COALESCE(attributes->>'topic', metadata->>'topic', '')) = $4
               AND LOWER(COALESCE(metadata->>'source', '')) = 'practice-news-auto'
               AND status <> $5
             ORDER BY created_at DESC
             LIMIT 1`,
            [currentId, normalizedDomain, CATEGORY_KEY, normalizedTopic, PENDING_DELETE_STATUS]
        )

        const previous = previousResult.rows?.[0]
        if (!previous?.id) return

        let previousMetadata = {}
        try {
            previousMetadata = typeof previous.metadata === 'string'
                ? JSON.parse(previous.metadata || '{}')
                : (previous.metadata || {})
        } catch {
            previousMetadata = {}
        }
        const nextMetadata = {
            ...previousMetadata,
            recycling: {
                ...(previousMetadata?.recycling || {}),
                previousStatus: String(previous.status || 'published').trim() || 'published',
                archivedBy: 'practice-news-auto',
                archivedAt,
            },
        }

        await connection.query(
            `UPDATE content
             SET status = $1,
                 metadata = $2::jsonb,
                 updated_at = NOW()
             WHERE id = $3`,
            [PENDING_DELETE_STATUS, JSON.stringify(nextMetadata), previous.id]
        )
    }

    try {
        const result = await connection.query(
            `INSERT INTO content (type, slug, status, attributes, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
            ['post', slug, 'published', attributes, metadata, nowIso, nowIso]
        )
        const inserted = result.rows[0] || null
        if (inserted?.id) {
            await archivePreviousRow(inserted.id)
        }
        return inserted
    } catch (insertError) {
        const message = String(insertError?.message || '')
        const isNullIdConstraint =
            message.includes('null value in column "id"') ||
            (insertError?.code === '23502' && message.includes('column "id"'))

        if (!isNullIdConstraint) throw insertError

        const sequenceResult = await connection.query(
            `SELECT pg_get_serial_sequence('content', 'id') AS seq_name`
        )
        const sequenceName = sequenceResult.rows?.[0]?.seq_name

        let nextId
        if (sequenceName) {
            const nextValResult = await connection.query(
                `SELECT nextval($1) AS next_id`,
                [sequenceName]
            )
            nextId = nextValResult.rows?.[0]?.next_id
        } else {
            const maxResult = await connection.query(
                `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM content`
            )
            nextId = maxResult.rows?.[0]?.next_id
        }

        const retryResult = await connection.query(
            `INSERT INTO content (id, type, slug, status, attributes, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
            [nextId, 'post', slug, 'published', attributes, metadata, nowIso, nowIso]
        )
        const inserted = retryResult.rows[0] || null
        if (inserted?.id) {
            await archivePreviousRow(inserted.id)
        }
        return inserted
    }
}

export async function GET(request) {
    let connection
    try {
        const { searchParams } = new URL(request.url)
        const requestedDomain = String(searchParams.get('domain') || DEFAULT_CONTENT_DOMAIN).trim().toLowerCase() || DEFAULT_CONTENT_DOMAIN
        const requestedTopic = normalizeTopic(searchParams.get('topic'))
        const dbType = detectDatabaseType()
        if (dbType === 'mongodb') {
            return NextResponse.json({ success: false, error: 'MongoDB not supported' }, { status: 400 })
        }

        let row = null
        let stale = true

        try {
            connection = await getDomainBoundConnection(requestedDomain)
            row = await fetchMostRecentIndustryNews(connection, requestedDomain, requestedTopic)
            stale = isArticleStale(row)
        } catch (readError) {
            console.warn('Practice industry news: DB read failed, generating fresh article:', readError?.message || readError)
        } finally {
            if (connection?.end) {
                await connection.end().catch(() => { })
                connection = null
            }
        }

        let generated = null
        if (stale) {
            generated = await generateIndustryNews(requestedTopic)
        }

        if (generated) {
            connection = await getDomainBoundConnection(requestedDomain)
            try {
                const inserted = await insertIndustryNewsPost(connection, generated, requestedDomain, requestedTopic)
                if (inserted) row = inserted
            } catch (insertError) {
                console.warn('Practice industry news insert failed:', insertError?.message || insertError)
            } finally {
                if (connection?.end) {
                    await connection.end().catch(() => { })
                    connection = null
                }
            }
        }

        if (row) {
            return NextResponse.json({ success: true, news: [buildNodeResponse(row)] })
        }

        if (generated) {
            const nowIso = new Date().toISOString()
            const ephemeralRow = {
                id: null,
                type: 'post',
                subtype: null,
                status: 'published',
                published_at: null,
                attributes: JSON.stringify({ domain: requestedDomain, category: CATEGORY_KEY, topic: requestedTopic }),
                metadata: JSON.stringify({
                    domain: requestedDomain,
                    category: CATEGORY_KEY,
                    topic: requestedTopic,
                    presentation: { default: { title: generated.title, summary: generated.summary } },
                    source: 'practice-news-auto',
                    sources: Array.isArray(generated.sources) ? generated.sources : []
                }),
                created_at: nowIso,
                updated_at: nowIso
            }
            return NextResponse.json({ success: true, news: [buildNodeResponse(ephemeralRow)] })
        }

        return NextResponse.json({ success: true, news: [] })
    } catch (error) {
        console.error('Practice industry news route error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
