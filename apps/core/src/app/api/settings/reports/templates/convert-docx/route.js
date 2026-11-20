import JSZip from 'jszip'
import mammoth from 'mammoth'
import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'

export const runtime = 'nodejs'

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function convertMammothImage(image) {
    return image.read('base64').then((buffer) => ({
        src: `data:${image.contentType};base64,${buffer}`,
    }))
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function parseRelationshipTargets(xml) {
    const relationships = new Map()
    const source = String(xml || '')
    const relationshipPattern = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g

    let match
    while ((match = relationshipPattern.exec(source)) !== null) {
        relationships.set(match[1], match[2])
    }

    return relationships
}

function getImageContentType(imagePath) {
    if (imagePath.endsWith('.png')) return 'image/png'
    if (imagePath.endsWith('.jpg') || imagePath.endsWith('.jpeg')) return 'image/jpeg'
    if (imagePath.endsWith('.gif')) return 'image/gif'
    if (imagePath.endsWith('.webp')) return 'image/webp'
    if (imagePath.endsWith('.svg')) return 'image/svg+xml'
    return 'application/octet-stream'
}

function extractParagraphTexts(xml) {
    const paragraphs = []
    const source = String(xml || '')
    const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/g

    for (const paragraphXml of source.match(paragraphPattern) || []) {
        const textParts = []
        // Require a space or `>` after `w:t` so sibling tags such as <w:tab>/<w:tabs> do not match and swallow raw XML.
        const textPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
        let textMatch
        while ((textMatch = textPattern.exec(paragraphXml)) !== null) {
            textParts.push(textMatch[1])
        }

        const text = textParts.join('').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
        if (text) {
            paragraphs.push(text)
        }
    }

    return paragraphs
}

function stripImageElements(html) {
    return String(html || '').replace(/<img\b[^>]*>/gi, '')
}

const BORDER_SIDES = ['top', 'left', 'bottom', 'right']

function parseBorderGroup(xml) {
    const group = {}
    for (const side of BORDER_SIDES) {
        const match = new RegExp(`<w:${side}\\b([^>]*)/?>`).exec(xml || '')
        if (!match) continue
        const attrs = match[1] || ''
        group[side] = {
            val: /w:val="([^"]+)"/.exec(attrs)?.[1] || '',
            sz: Number.parseInt(/w:sz="(\d+)"/.exec(attrs)?.[1] || '4', 10),
            color: /w:color="([^"]+)"/.exec(attrs)?.[1] || 'auto',
        }
    }
    return group
}

function borderToCss(border) {
    if (!border) return null

    const val = String(border.val || '').toLowerCase()
    if (!val || val === 'nil' || val === 'none') return '0'

    const widthPt = Math.max(0.5, (Number.isFinite(border.sz) ? border.sz : 4) / 8)
    const color = border.color && border.color !== 'auto' ? `#${border.color.replace(/^#/, '')}` : '#000000'
    const style = ['double', 'dashed', 'dotted'].includes(val) ? val : 'solid'
    return `${widthPt}pt ${style} ${color}`
}

function parseTableStyleBorders(stylesXml) {
    const definitions = new Map()
    const stylePattern = /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g

    let match
    while ((match = stylePattern.exec(String(stylesXml || ''))) !== null) {
        const borders = /<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/.exec(match[2])?.[1] || ''
        definitions.set(match[1], {
            basedOn: /<w:basedOn w:val="([^"]+)"/.exec(match[2])?.[1] || '',
            borders: borders ? parseBorderGroup(borders) : null,
        })
    }

    const resolved = new Map()
    for (const styleId of definitions.keys()) {
        const seen = new Set()
        let current = styleId
        let borders = null

        while (current && definitions.has(current) && !seen.has(current)) {
            seen.add(current)
            const definition = definitions.get(current)
            if (definition.borders) {
                borders = { ...definition.borders, ...(borders || {}) }
            }
            current = definition.basedOn
        }

        if (borders) resolved.set(styleId, borders)
    }

    return resolved
}

function getUsableTextWidthTwips(documentXml) {
    const sections = String(documentXml || '').match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) || []
    const section = sections[sections.length - 1] || ''
    const pageWidth = Number.parseInt(/<w:pgSz\b[^>]*w:w="(\d+)"/.exec(section)?.[1] || '0', 10)
    const margins = /<w:pgMar\b[^>]*>/.exec(section)?.[0] || ''
    const left = Number.parseInt(/w:left="(\d+)"/.exec(margins)?.[1] || '0', 10)
    const right = Number.parseInt(/w:right="(\d+)"/.exec(margins)?.[1] || '0', 10)
    const usable = pageWidth - left - right

    return usable > 0 ? usable : 9632
}

function resolveTableWidthPercent(tablePropsXml, gridTotalTwips, usableTwips) {
    const widthTag = /<w:tblW\b[^>]*>/.exec(tablePropsXml || '')?.[0] || ''
    const type = /w:type="([^"]+)"/.exec(widthTag)?.[1] || 'auto'
    const value = Number.parseInt(/w:w="(\d+)"/.exec(widthTag)?.[1] || '0', 10)

    // Word stores pct table widths in fiftieths of a percent.
    let percent = 0
    if (type === 'pct' && value > 0) percent = value / 50
    else if (type === 'dxa' && value > 0) percent = (value / usableTwips) * 100
    else if (gridTotalTwips > 0) percent = (gridTotalTwips / usableTwips) * 100

    if (!Number.isFinite(percent) || percent <= 0) return null
    return Math.round(Math.min(100, Math.max(5, percent)) * 100) / 100
}

function extractTableCellBorders(documentXml, styleBorders) {
    const source = String(documentXml || '')
    const usableTwips = getUsableTextWidthTwips(source)
    const tokenPattern = /<w:tbl>|<\/w:tbl>|<w:tr\b[^>]*>|<\/w:tr>|<w:tc>|<w:tblPr>[\s\S]*?<\/w:tblPr>|<w:tblGrid>[\s\S]*?<\/w:tblGrid>|<w:tcPr>[\s\S]*?<\/w:tcPr>/g

    const tables = []
    const stack = []
    let match

    while ((match = tokenPattern.exec(source)) !== null) {
        const token = match[0]

        if (token === '<w:tbl>') {
            const table = { defaults: {}, rows: [], columns: [], widthPercent: null, fixedLayout: false, propsXml: '' }
            tables.push(table)
            stack.push(table)
            continue
        }

        if (token === '</w:tbl>') {
            stack.pop()
            continue
        }

        const table = stack[stack.length - 1]
        if (!table) continue

        if (token.startsWith('<w:tblPr>')) {
            const styleId = /<w:tblStyle w:val="([^"]+)"/.exec(token)?.[1] || ''
            const borders = /<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/.exec(token)?.[1] || ''
            table.defaults = {
                ...(styleBorders.get(styleId) || {}),
                ...(borders ? parseBorderGroup(borders) : {}),
            }
            table.propsXml = token
            table.fixedLayout = /<w:tblLayout\b[^>]*w:type="fixed"/.test(token)
            continue
        }

        if (token.startsWith('<w:tblGrid>')) {
            table.columns = Array.from(token.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"/g), (col) => Number.parseInt(col[1], 10))
                .filter((width) => Number.isFinite(width) && width > 0)
            continue
        }

        if (token.startsWith('<w:tr')) {
            table.rows.push([])
            continue
        }

        if (token === '<w:tc>') {
            table.rows[table.rows.length - 1]?.push({ borders: null, skip: false })
            continue
        }

        if (token.startsWith('<w:tcPr>')) {
            const row = table.rows[table.rows.length - 1]
            const cell = row?.[row.length - 1]
            if (!cell) continue

            // Mammoth folds vertically merged continuation cells into a rowspan, so they have no HTML counterpart.
            const vMerge = /<w:vMerge\b([^>]*)\/?>/.exec(token)
            if (vMerge && !/w:val="restart"/.test(vMerge[1] || '')) {
                cell.skip = true
            }

            const borders = /<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/.exec(token)?.[1] || ''
            cell.borders = borders ? parseBorderGroup(borders) : null
        }
    }

    return tables.map((table) => {
        const hasTableBorders = Object.keys(table.defaults).length > 0
        const gridTotal = table.columns.reduce((total, width) => total + width, 0)

        return {
            widthPercent: resolveTableWidthPercent(table.propsXml, gridTotal, usableTwips),
            fixedLayout: table.fixedLayout,
            columnPercents: gridTotal > 0
                ? table.columns.map((width) => Math.round((width / gridTotal) * 10000) / 100)
                : [],
            rows: table.rows.map((row) => row
                .filter((cell) => !cell.skip)
                .map((cell) => {
                    if (!hasTableBorders && !cell.borders) return null

                    const resolved = {}
                    for (const side of BORDER_SIDES) {
                        resolved[side] = borderToCss(cell.borders?.[side] || table.defaults[side]) || '0'
                    }
                    return resolved
                })),
        }
    })
}

function buildColgroup(columnPercents) {
    if (columnPercents.length === 0) return ''
    return `<colgroup>${columnPercents.map((percent) => `<col style="width: ${percent}%" />`).join('')}</colgroup>`
}

function applyTableLayout(html, tableLayouts) {
    const source = String(html || '')
    if (!source || tableLayouts.length === 0) return source

    const tokenPattern = /<table\b[^>]*>|<\/table>|<tr\b[^>]*>|<t[dh]\b[^>]*>/g

    const openTables = []
    let tableIndex = -1
    let result = ''
    let cursor = 0
    let match

    while ((match = tokenPattern.exec(source)) !== null) {
        const token = match[0]
        result += source.slice(cursor, match.index)
        cursor = match.index + token.length

        if (token.startsWith('<table')) {
            tableIndex += 1
            openTables.push({ index: tableIndex, row: -1, cell: -1 })

            const layout = tableLayouts[tableIndex]
            const declarations = []
            if (layout?.widthPercent) declarations.push(`width: ${layout.widthPercent}%`)
            if (layout?.fixedLayout && layout.columnPercents.length > 0) declarations.push('table-layout: fixed')

            const openTag = declarations.length > 0
                ? token.replace(/\s*\/?>$/, ` style="${declarations.join('; ')}">`)
                : token

            result += `${openTag}${buildColgroup(layout?.columnPercents || [])}`
            continue
        }

        if (token === '</table>') {
            openTables.pop()
            result += token
            continue
        }

        const current = openTables[openTables.length - 1]
        if (!current) {
            result += token
            continue
        }

        if (token.startsWith('<tr')) {
            current.row += 1
            current.cell = -1
            result += token
            continue
        }

        current.cell += 1
        const borders = tableLayouts[current.index]?.rows?.[current.row]?.[current.cell]
        if (!borders) {
            result += token
            continue
        }

        const declarations = BORDER_SIDES.map((side) => `border-${side}: ${borders[side]}`).join('; ')
        result += token.replace(/\s*\/?>$/, ` style="${declarations}">`)
    }

    return result + source.slice(cursor)
}

async function applyDocxTableStyling(buffer, html) {
    const zip = await JSZip.loadAsync(buffer)
    const documentXml = await zip.file('word/document.xml')?.async('string')
    if (!documentXml) return html

    const stylesXml = await zip.file('word/styles.xml')?.async('string').catch(() => '')
    const tableLayouts = extractTableCellBorders(documentXml, parseTableStyleBorders(stylesXml))
    return applyTableLayout(html, tableLayouts)
}

async function extractDocPartHtml(buffer, partPrefix, partLabel, options = {}) {
    const { includeImages = true } = options
    const zip = await JSZip.loadAsync(buffer)
    const htmlBlocks = []
    const partXmlFiles = Object.keys(zip.files).filter((fileName) => new RegExp(`^word\\/${partPrefix}\\d+\\.xml$`).test(fileName))

    for (const partXmlFile of partXmlFiles) {
        const partXml = await zip.file(partXmlFile)?.async('string').catch(() => '')
        if (!partXml) continue

        const relsFile = partXmlFile.replace(/^word\//, 'word/_rels/') + '.rels'
        const relsXml = await zip.file(relsFile)?.async('string').catch(() => '')
        const relationshipTargets = parseRelationshipTargets(relsXml)

        const paragraphTexts = extractParagraphTexts(partXml)
        const imageIds = includeImages
            ? Array.from(partXml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"[^>]*\/?>(?:<\/a:blip>)?/g), (match) => match[1])
            : []
        const imageHtmlParts = []

        for (const relationshipId of imageIds) {
            const target = relationshipTargets.get(relationshipId)
            if (!target) continue

            const normalizedTarget = String(target).replace(/^\.\//, '')
            const imagePath = `word/${normalizedTarget}`.split('\\').join('/')
            const imageFile = zip.file(imagePath)
            if (!imageFile) continue

            const imageBuffer = await imageFile.async('base64')
            const contentType = getImageContentType(imagePath)

            imageHtmlParts.push(`<img src="data:${contentType};base64,${imageBuffer}" alt="${partLabel} image" />`)
        }

        const paragraphHtml = paragraphTexts.length > 0
            ? paragraphTexts.map((paragraphText) => `<p>${escapeHtml(paragraphText)}</p>`).join('')
            : ''
        const partHtml = `${paragraphHtml}${imageHtmlParts.join('')}`

        if (partHtml) {
            htmlBlocks.push(`<div class="docx-${partLabel}">${partHtml}</div>`)
        }
    }

    return htmlBlocks.join('')
}

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const fromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    if (fromHeader) return fromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

function resolveScopedDomain(adminUser, requestedDomain) {
    const requested = normalizeDomainKey(requestedDomain)

    if (isSuperAdmin(adminUser)) {
        return requested
    }

    const scopedDomain = normalizeDomainKey(adminUser?.domain)
    if (!scopedDomain) return ''

    if (requested && requested !== scopedDomain) {
        return null
    }

    return scopedDomain
}

export async function POST(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const domain = resolveScopedDomain(adminUser, payload?.domain)
        if (domain === null) {
            return NextResponse.json({ error: 'Forbidden: cannot convert template for requested domain' }, { status: 403 })
        }
        if (!domain) {
            return NextResponse.json({ error: 'domain is required' }, { status: 400 })
        }

        const template = payload?.template && typeof payload.template === 'object' ? payload.template : {}
        const mimeType = String(template?.mimeType || '').trim().toLowerCase()
        if (mimeType !== DOCX_MIME_TYPE) {
            return NextResponse.json({ error: 'Template must be a DOCX file' }, { status: 400 })
        }

        const contentBase64 = String(template?.contentBase64 || '').trim()
        if (!contentBase64) {
            return NextResponse.json({ error: 'DOCX template content is empty' }, { status: 400 })
        }

        const buffer = Buffer.from(contentBase64, 'base64')
        if (!buffer || buffer.length === 0) {
            return NextResponse.json({ error: 'DOCX template could not be decoded' }, { status: 400 })
        }

        const includeImages = payload?.includeImages !== false

        const [htmlResult, textResult, headerHtml, footerHtml] = await Promise.all([
            includeImages
                ? mammoth.convertToHtml({ buffer, convertImage: mammoth.images.inline(convertMammothImage) })
                : mammoth.convertToHtml({ buffer }),
            mammoth.extractRawText({ buffer }),
            extractDocPartHtml(buffer, 'header', 'header', { includeImages }).catch(() => ''),
            extractDocPartHtml(buffer, 'footer', 'footer', { includeImages }).catch(() => ''),
        ])

        const rawBodyHtml = includeImages ? String(htmlResult?.value || '') : stripImageElements(htmlResult?.value)
        const bodyHtml = await applyDocxTableStyling(buffer, rawBodyHtml).catch(() => rawBodyHtml)
        const combinedHtml = `${String(headerHtml || '').trim()}${bodyHtml.trim()}${String(footerHtml || '').trim()}`

        return NextResponse.json({
            success: true,
            html: combinedHtml,
            text: String(textResult?.value || '').trim(),
            conversionMessages: Array.isArray(htmlResult?.messages) ? htmlResult.messages : [],
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to convert DOCX template' }, { status: 500 })
    }
}
