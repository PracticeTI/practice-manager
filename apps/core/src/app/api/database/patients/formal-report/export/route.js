import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { readFile } from 'fs/promises'
import path from 'path'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { readReportSettingsForDomain } from '@/lib/reportSettingsStore'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import {
    findMissingAnchorsInText,
    normalizeRequiredAnchors,
    normalizeRequiredPlaceholders,
} from '@/lib/reportTemplatePolicies'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    extractHtmlTableLayout,
    isHtmlTableHeaderRow,
    resolveWordTableWidths,
    wrapWordTableXml,
} from '@/lib/docxTableLayout'
import { buildWordImageParagraphXml, imageLeadsLine } from '@/lib/docxImageParagraph'
import { buildReportHeaderXml } from '@/lib/docxReportHeader'
import { buildReportBranding } from '@/lib/reportBranding'
import { buildWordCoverParagraphXml, buildWordCoverRuleXml } from '@/lib/reportCover'
import { isNumberedSectionHeading, isReportPageBreak, stripReportPageBreaks } from '@/lib/reportPageBreaks'
import {
    buildWordStylesXml,
    WORD_DOCUMENT_GRID_LINE_PITCH_TWIPS,
    WORD_PAGE_HEIGHT_TWIPS,
    WORD_PAGE_MARGIN_TWIPS,
    WORD_PAGE_WIDTH_TWIPS,
} from '@/lib/docxWordStyles'
import {
    REPORT_BRANDED_PAGE_MARGIN_TWIPS,
    REPORT_HEADER_LOGO_HEIGHT_TWIPS,
    REPORT_HEADER_TOP_TWIPS,
    REPORT_LIST_HANGING_TWIPS,
    REPORT_LIST_INDENT_TWIPS,
    REPORT_LIST_ITEM_SPACE_AFTER_TWIPS,
    REPORT_QUOTE_BORDER_COLOR,
    REPORT_QUOTE_BORDER_SIZE_EIGHTHS,
    REPORT_QUOTE_BORDER_SPACE_POINTS,
    REPORT_QUOTE_FILL_COLOR,
    REPORT_QUOTE_SPACE_TWIPS,
    REPORT_TABLE_BORDER_COLOR,
    REPORT_TABLE_BORDER_SIZE_EIGHTHS,
    REPORT_TABLE_CELL_MARGIN_TWIPS,
} from '@/lib/reportPageMetrics'
import { isTacSectionLabel, normalizeTacHeading } from '@/lib/tacReportHeadings'
import {
    buildCalloutBorderXml,
    buildCalloutShadingXml,
    resolveCalloutPalette,
    takeCalloutFromBlocks,
} from '@/lib/reportCallouts'

export const runtime = 'nodejs'

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MARKDOWN_TEMPLATE_MIME_TYPES = new Set([
    'text/markdown',
    'text/x-markdown',
    'text/plain',
])

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
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

function normalizeText(value, maxLength = 200000) {
    return String(value || '').slice(0, maxLength)
}

function normalizePatientId(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return parsed
}

function parseJsonObject(value) {
    if (!value) return null
    if (typeof value === 'object' && !Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
        return null
    }
}

function toWordFriendlyText(markdown) {
    const source = stripReportPageBreaks(String(markdown || '')).replace(/\r\n/g, '\n')
    if (!source.trim()) return ''

    return source
        .replace(/```[\s\S]*?```/g, (block) => {
            const inner = block.replace(/^```/, '').replace(/```$/, '').trim()
            return inner ? `\n${inner}\n` : '\n'
        })
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_`~]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function buildWordRunXml(text, options = {}) {
    const source = String(text || '')
    if (!source) return ''

    const escaped = xmlEscape(source)
    const runProps = []
    if (options.bold) runProps.push('<w:b/>')
    if (options.italic) runProps.push('<w:i/>')
    if (options.smallCaps) runProps.push('<w:smallCaps/>')
    // A link keeps its blue unless the caller supplies a base colour, which is what callouts do so
    // that links stay legible on a filled box.
    const color = options.link ? (options.color || '0563C1') : options.color
    if (color) runProps.push(`<w:color w:val="${color}"/>`)
    if (options.size) runProps.push(`<w:sz w:val="${options.size}"/>`)
    if (options.code) {
        runProps.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')
        runProps.push('<w:sz w:val="20"/>')
    }
    if (options.link) {
        runProps.push('<w:u w:val="single"/>')
    }

    const rPr = runProps.length > 0 ? `<w:rPr>${runProps.join('')}</w:rPr>` : ''
    return `<w:r>${rPr}<w:t xml:space="preserve">${escaped}</w:t></w:r>`
}

function toWordInlineRunsXml(text, options = {}) {
    const source = normalizeDanglingEmphasis(String(text || ''))
    if (!source) {
        return '<w:r><w:t xml:space="preserve"> </w:t></w:r>'
    }

    // Inline runs inside a callout inherit the box's text colour; links keep their own.
    const baseRun = options.color ? { color: options.color } : {}
    const pattern = /\[([^\]]+)\]\(([^)]+)\)|(\*\*|__)(.+?)\3|(`)([^`\n]+)\5|(\*|_)([^\n]+?)\7/g
    const runs = []
    let lastIndex = 0
    let match

    while ((match = pattern.exec(source)) !== null) {
        if (match.index > lastIndex) {
            runs.push(buildWordRunXml(source.slice(lastIndex, match.index), baseRun))
        }

        if (match[1] && match[2]) {
            runs.push(buildWordRunXml(match[1], { ...baseRun, link: true }))
            runs.push(buildWordRunXml(` (${match[2]})`, baseRun))
        } else if (match[4]) {
            runs.push(buildWordRunXml(match[4], { ...baseRun, bold: true }))
        } else if (match[6]) {
            runs.push(buildWordRunXml(match[6], { ...baseRun, code: true }))
        } else if (match[8]) {
            runs.push(buildWordRunXml(match[8], { ...baseRun, italic: true }))
        }

        lastIndex = pattern.lastIndex
    }

    if (lastIndex < source.length) {
        runs.push(buildWordRunXml(source.slice(lastIndex), baseRun))
    }

    return runs.length > 0 ? runs.join('') : '<w:r><w:t xml:space="preserve"> </w:t></w:r>'
}

function toWordParagraphXmlFromBlocks(markdown) {
    const source = String(markdown || '').replace(/\r\n/g, '\n')
    const lines = source.split('\n')
    const paragraphs = []
    let pendingTacSectionTitle = false

    let index = 0
    while (index < lines.length) {
        const line = lines[index]
        const trimmed = line.trim()

        if (!trimmed) {
            index += 1
            continue
        }

        if (isReportPageBreak(trimmed)) {
            paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
            index += 1
            continue
        }

        // Cover lines are raw HTML marked with `data-cover-line`; they carry the reference cover's
        // Calibri sizes so Word does not fall back to the report's Times body paragraph.
        if (/^<hr\b[^>]*data-cover-line="rule"[^>]*\/?>$/i.test(trimmed)) {
            paragraphs.push(buildWordCoverRuleXml())
            index += 1
            continue
        }

        const coverLineMatch = trimmed.match(/^<(p|h1)\b[^>]*data-cover-line="([a-z-]+)"[^>]*>([\s\S]*?)(<\/\1>)?$/i)
        if (coverLineMatch) {
            let coverInner = coverLineMatch[3]
            index += 1
            if (!coverLineMatch[4]) {
                while (index < lines.length) {
                    coverInner += `\n${lines[index]}`
                    const closes = new RegExp(`</${coverLineMatch[1]}>`, 'i').test(lines[index])
                    index += 1
                    if (closes) break
                }
            }
            const coverXml = buildWordCoverParagraphXml(
                coverLineMatch[2],
                coverInner.replace(new RegExp(`</${coverLineMatch[1]}>\\s*$`, 'i'), '').trim()
            )
            if (coverXml) paragraphs.push(coverXml)
            continue
        }

        if (/^<table\b/i.test(trimmed)) {
            const tableLines = [line]
            index += 1
            if (!/<\/table>/i.test(line)) {
                while (index < lines.length) {
                    tableLines.push(lines[index])
                    if (/<\/table>/i.test(lines[index])) {
                        index += 1
                        break
                    }
                    index += 1
                }
            }

            const parsedTable = parseHtmlTableRows(tableLines.join('\n'))
            const tableXml = buildWordTableXml(parsedTable.rows, parsedTable.layout)
            if (tableXml) {
                paragraphs.push(tableXml)
            }
            continue
        }

        if (trimmed.includes('|') && index + 1 < lines.length) {
            const markdownTable = parseMarkdownTableRows(lines, index)
            if (markdownTable.rows.length > 0) {
                const tableXml = buildWordTableXml(markdownTable.rows)
                if (tableXml) {
                    paragraphs.push(tableXml)
                }
                index = markdownTable.nextIndex
                continue
            }
        }

        if (/^```/.test(trimmed)) {
            index += 1
            while (index < lines.length && !/^```/.test(lines[index].trim())) {
                const codeLine = lines[index]
                const codeText = codeLine ? xmlEscape(codeLine) : ' '
                paragraphs.push(
                    `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:ind w:left="360"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${codeText}</w:t></w:r></w:p>`
                )
                index += 1
            }
            if (index < lines.length) index += 1
            continue
        }

        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
        if (headingMatch) {
            const level = headingMatch[1].length
            const text = normalizeDanglingEmphasis(headingMatch[2].trim())
            if (level === 1 && isTacSectionLabel(text)) {
                paragraphs.push(
                    `<w:p><w:pPr><w:spacing w:before="280" w:after="60"/></w:pPr>${buildWordRunXml(normalizeTacHeading(text), { bold: true, size: 24 })}</w:p>`
                )
                pendingTacSectionTitle = true
                index += 1
                continue
            }
            if (level === 2 && pendingTacSectionTitle) {
                paragraphs.push(
                    `<w:p><w:pPr><w:spacing w:before="0" w:after="200"/><w:pBdr><w:bottom w:val="single" w:sz="24" w:space="6" w:color="C8C8C8"/></w:pBdr></w:pPr>${buildWordRunXml(normalizeTacHeading(text), { bold: true, smallCaps: true, color: '1E2850', size: 28 })}</w:p>`
                )
                pendingTacSectionTitle = false
                index += 1
                continue
            }
            pendingTacSectionTitle = false
            const styleId = level <= 1 ? 'Heading1' : level === 2 ? 'Heading2' : 'Heading3'
            // Every numbered section starts on a new A4 page. `pageBreakBefore` on the
            // heading avoids a leading blank page when the heading is the first block.
            const pageBreakBefore = level === 2 && isNumberedSectionHeading(text)
                ? '<w:pageBreakBefore/>'
                : ''
            paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="${styleId}"/>${pageBreakBefore}</w:pPr>${toWordInlineRunsXml(text)}</w:p>`)
            index += 1
            continue
        }

        pendingTacSectionTitle = false

        const boldHeadingMatch = trimmed.match(/^(\*\*|__)([^\n]+?)\1[*_]*\s*$/)
        if (boldHeadingMatch) {
            const headingText = normalizeDanglingEmphasis(String(boldHeadingMatch[2] || '').trim())
            if (headingText) {
                const pageBreakBefore = isNumberedSectionHeading(headingText)
                    ? '<w:pageBreakBefore/>'
                    : ''
                paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Heading2"/>${pageBreakBefore}</w:pPr>${toWordInlineRunsXml(headingText)}</w:p>`)
                index += 1
                continue
            }
        }

        const blockquoteMatch = line.match(/^>\s?(.*)$/)
        if (blockquoteMatch) {
            const quoteBlocks = []
            let currentQuoteBlock = []
            while (index < lines.length) {
                const quoteMatch = lines[index].match(/^>\s?(.*)$/)
                if (!quoteMatch) break
                const quoteLine = quoteMatch[1].trim()
                if (!quoteLine && currentQuoteBlock.length > 0) {
                    quoteBlocks.push(currentQuoteBlock)
                    currentQuoteBlock = []
                } else if (quoteLine) {
                    currentQuoteBlock.push(quoteLine)
                }
                index += 1
            }
            if (currentQuoteBlock.length > 0) quoteBlocks.push(currentQuoteBlock)

            // A `[!variant]` marker on the quote's first line turns it into a boxed callout: full
            // border, filled background and, for the dark palettes, light text. Without a marker the
            // quote keeps the left rule and pale fill the preview draws.
            //
            // One paragraph per paragraph inside the quote, carrying the callout border and fill the
            // preview draws. Identical borders on adjacent paragraphs with no space between them
            // render as one continuous box, which is what the preview shows.
            const callout = takeCalloutFromBlocks(quoteBlocks)
            const calloutPalette = resolveCalloutPalette(callout.variant)
            const calloutBlocks = calloutPalette ? callout.blocks : quoteBlocks
            if (calloutBlocks.length === 0) continue

            const quoteBorder = calloutPalette
                ? buildCalloutBorderXml(calloutPalette.name)
                : `<w:pBdr><w:left w:val="single" w:sz="${REPORT_QUOTE_BORDER_SIZE_EIGHTHS}" w:space="${REPORT_QUOTE_BORDER_SPACE_POINTS}" w:color="${REPORT_QUOTE_BORDER_COLOR}"/></w:pBdr>`
            const quoteShading = calloutPalette
                ? buildCalloutShadingXml(calloutPalette.name)
                : `<w:shd w:val="clear" w:color="auto" w:fill="${REPORT_QUOTE_FILL_COLOR}"/>`
            const quoteRunOptions = calloutPalette ? { color: calloutPalette.textColor } : {}
            // A centred callout (the cover's "Prepared for" panel) keeps the full-width box and
            // centres the text inside it, matching the preview stylesheet.
            const quoteAlignment = calloutPalette?.align ? `<w:jc w:val="${calloutPalette.align}"/>` : ''

            if (calloutPalette?.singleBox) {
                const runs = calloutBlocks
                    .map((quoteBlock) => toWordInlineRunsXml(quoteBlock.join(' '), quoteRunOptions))
                    .join('<w:r><w:br/></w:r>')
                paragraphs.push(
                    `<w:p><w:pPr>${quoteBorder}${quoteShading}<w:spacing w:before="${REPORT_QUOTE_SPACE_TWIPS}" w:after="${REPORT_QUOTE_SPACE_TWIPS}"/>${quoteAlignment}</w:pPr>${runs}</w:p>`
                )
                continue
            }

            calloutBlocks.forEach((quoteBlock, quoteIndex) => {
                const isFirst = quoteIndex === 0
                const isLast = quoteIndex === calloutBlocks.length - 1
                const before = isFirst ? REPORT_QUOTE_SPACE_TWIPS : 0
                const after = isLast ? REPORT_QUOTE_SPACE_TWIPS : 0
                paragraphs.push(
                    `<w:p><w:pPr>${quoteBorder}${quoteShading}<w:spacing w:before="${before}" w:after="${after}"/>${quoteAlignment}</w:pPr>${toWordInlineRunsXml(quoteBlock.join(' '), quoteRunOptions)}</w:p>`
                )
            })
            continue
        }

        const unorderedMatch = line.match(/^[-*+]\s+(.+)$/)
        if (unorderedMatch) {
            while (index < lines.length) {
                const itemMatch = lines[index].match(/^[-*+]\s+(.+)$/)
                if (!itemMatch) break
                paragraphs.push(
                    `<w:p><w:pPr><w:ind w:left="${REPORT_LIST_INDENT_TWIPS}" w:hanging="${REPORT_LIST_HANGING_TWIPS}"/><w:spacing w:before="0" w:after="${REPORT_LIST_ITEM_SPACE_AFTER_TWIPS}"/></w:pPr>${toWordInlineRunsXml(`• ${itemMatch[1].trim()}`)}</w:p>`
                )
                index += 1
            }
            continue
        }

        const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/)
        if (orderedMatch) {
            let counter = 1
            while (index < lines.length) {
                const itemMatch = lines[index].match(/^\d+[.)]\s+(.+)$/)
                if (!itemMatch) break
                paragraphs.push(
                    `<w:p><w:pPr><w:ind w:left="${REPORT_LIST_INDENT_TWIPS}" w:hanging="${REPORT_LIST_HANGING_TWIPS}"/><w:spacing w:before="0" w:after="${REPORT_LIST_ITEM_SPACE_AFTER_TWIPS}"/></w:pPr>${toWordInlineRunsXml(`${counter}. ${itemMatch[1].trim()}`)}</w:p>`
                )
                counter += 1
                index += 1
            }
            continue
        }

        const paragraphLines = [normalizeDanglingEmphasis(stripHtmlTags(line.trim()))]
        index += 1
        while (index < lines.length) {
            const next = lines[index]
            const nextTrimmed = next.trim()
            if (!nextTrimmed) break
            if (/^(#{1,6})\s+/.test(nextTrimmed)) break
            if (/^```/.test(nextTrimmed)) break
            if (/^>\s?/.test(nextTrimmed)) break
            if (/^[-*+]\s+/.test(nextTrimmed)) break
            if (/^\d+[.)]\s+/.test(nextTrimmed)) break
            if (/^<table\b/i.test(nextTrimmed)) break
            if (isReportPageBreak(nextTrimmed)) break
            paragraphLines.push(normalizeDanglingEmphasis(stripHtmlTags(nextTrimmed)))
            index += 1
        }
        const paragraphText = paragraphLines.join(' ').trim()
        if (paragraphText) {
            paragraphs.push(`<w:p>${toWordInlineRunsXml(paragraphText)}</w:p>`)
        }
    }

    return paragraphs.join('')
}

/** A logo extent for the running header: fixed height, width from the raster's aspect ratio. */
function getWordImageExtentForHeader(imageAsset) {
    const heightEmu = Math.max(1, Math.round(REPORT_HEADER_LOGO_HEIGHT_TWIPS * 635))
    const dimensions = getRasterImageDimensions(imageAsset?.buffer, imageAsset?.extension)
    const ratio = dimensions && dimensions.height > 0 ? dimensions.width / dimensions.height : 3
    return {
        cx: Math.max(1, Math.round(heightEmu * (Number.isFinite(ratio) && ratio > 0 ? ratio : 3))),
        cy: heightEmu,
    }
}

async function buildSimpleDocxFromText(markdown, { branding = null } = {}) {
    const zip = new JSZip()
    const header = branding && (branding.text || branding.logoUrl) ? branding : null
    const headerLogoAsset = header?.logoUrl ? await resolveImageAsset(header.logoUrl) : null
    const headerLogoExtent = headerLogoAsset ? getWordImageExtentForHeader(headerLogoAsset) : null
    const hasHeader = Boolean(header && (header.text || headerLogoExtent))

    const docxBody = await buildWordBodyXmlWithImages(markdown, { skipTemplateHeaderImages: hasHeader })
    const paragraphXml = docxBody.xml

    for (const mediaFile of docxBody.mediaFiles) {
        zip.file(mediaFile.path, mediaFile.buffer)
    }

    let headerMediaFile = null
    if (headerLogoAsset && headerLogoExtent) {
        headerMediaFile = `header-logo.${headerLogoAsset.extension}`
        zip.file(`word/media/${headerMediaFile}`, headerLogoAsset.buffer)
    }

    const imageContentTypes = new Map(docxBody.imageContentTypes)
    if (headerLogoAsset) imageContentTypes.set(headerLogoAsset.extension, headerLogoAsset.contentType)

    const imageDefaultTypesXml = Array.from(imageContentTypes.entries())
        .map(([extension, contentType]) => `    <Default Extension="${xmlEscape(extension)}" ContentType="${xmlEscape(contentType)}"/>`)
        .join('\n')

    const headerContentTypeXml = hasHeader
        ? '\n    <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
        : ''

    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
${imageDefaultTypesXml ? `${imageDefaultTypesXml}\n` : ''}    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${headerContentTypeXml}
</Types>`)

    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)

    const imageRelationshipXml = docxBody.relationships
        .map((relationship) => `    <Relationship Id="${relationship.id}" Type="${relationship.type}" Target="${relationship.target}"/>`)
        .join('\n')

    const headerRelationshipXml = hasHeader
        ? '\n    <Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
        : ''

    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${imageRelationshipXml ? `${imageRelationshipXml}\n` : ''}${headerRelationshipXml}</Relationships>`)

    if (hasHeader) {
        const headerLogoRelationshipId = headerMediaFile && headerLogoExtent ? 'rIdHeaderLogo' : ''
        zip.file('word/header1.xml', buildReportHeaderXml({
            logoRelationshipId: headerLogoRelationshipId,
            logoExtent: headerLogoExtent,
            altText: header.logoAlt || 'Practice logo',
            text: header.text,
        }))
        if (headerLogoRelationshipId) {
            zip.file('word/_rels/header1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="${headerLogoRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${headerMediaFile}"/>
</Relationships>`)
        }
    }

    zip.file('word/styles.xml', buildWordStylesXml())

    const headerReferenceXml = hasHeader
        ? '\n            <w:headerReference w:type="default" r:id="rIdHeader"/>'
        : ''
    const pageTopMarginTwips = hasHeader ? REPORT_BRANDED_PAGE_MARGIN_TWIPS : WORD_PAGE_MARGIN_TWIPS
    const headerOffsetTwips = hasHeader ? REPORT_HEADER_TOP_TWIPS : 708

    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
    xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
    xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
    xmlns:v="urn:schemas-microsoft-com:vml"
    xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:w10="urn:schemas-microsoft-com:office:word"
    xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
    xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
    xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"
    xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"
    xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml"
    xmlns:w16sdtdh="http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash"
    xmlns:w16se="http://schemas.microsoft.com/office/word/2015/wordml/symex"
    xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
    xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
    xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
    mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh wp14">
    <w:body>
        ${paragraphXml}
        <w:sectPr>${headerReferenceXml}
            <w:pgSz w:w="${WORD_PAGE_WIDTH_TWIPS}" w:h="${WORD_PAGE_HEIGHT_TWIPS}"/>
            <w:pgMar w:top="${pageTopMarginTwips}" w:right="${WORD_PAGE_MARGIN_TWIPS}" w:bottom="${WORD_PAGE_MARGIN_TWIPS}" w:left="${WORD_PAGE_MARGIN_TWIPS}" w:header="${headerOffsetTwips}" w:footer="708" w:gutter="0"/>
            <w:cols w:space="708"/>
            <w:docGrid w:linePitch="${WORD_DOCUMENT_GRID_LINE_PITCH_TWIPS}"/>
        </w:sectPr>
    </w:body>
</w:document>`)

    return zip.generateAsync({ type: 'nodebuffer' })
}

function xmlEscape(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function detectImageExtensionFromMime(contentType) {
    const mime = String(contentType || '').trim().toLowerCase()
    if (mime === 'image/png') return 'png'
    if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
    if (mime === 'image/gif') return 'gif'
    if (mime === 'image/webp') return 'webp'
    return ''
}

function normalizeImageSource(rawSource) {
    const source = String(rawSource || '').trim().replace(/^<|>$/g, '')
    if (!source) return ''
    if (/^https?:\/\//i.test(source)) return source
    if (/^data:image\//i.test(source)) return source
    if (source.startsWith('/')) return source
    return ''
}

function contentTypeFromImageExtension(extension) {
    const normalized = String(extension || '').trim().toLowerCase()
    if (normalized === '.png') return 'image/png'
    if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg'
    if (normalized === '.gif') return 'image/gif'
    if (normalized === '.webp') return 'image/webp'
    return ''
}

function resolvePublicImageAbsolutePath(source) {
    const cleaned = String(source || '').trim().split('#')[0].split('?')[0]
    if (!cleaned.startsWith('/')) return ''

    const decodedPath = decodeURIComponent(cleaned)
    const relativePath = decodedPath.replace(/^\/+/, '')
    if (!relativePath) return ''

    const publicRoot = path.resolve(process.cwd(), 'public')
    const absolutePath = path.resolve(publicRoot, relativePath)
    if (absolutePath !== publicRoot && !absolutePath.startsWith(`${publicRoot}${path.sep}`)) {
        return ''
    }

    return absolutePath
}

function extractImageRefsFromLine(line) {
    const refs = []
    const source = String(line || '')
    if (!source) return refs

    const markdownPattern = /!\[([^\]]*)\]\(([^)]+)\)/g
    let markdownMatch
    while ((markdownMatch = markdownPattern.exec(source)) !== null) {
        const altText = String(markdownMatch[1] || '').trim()
        const rawTarget = String(markdownMatch[2] || '').trim()
        const target = rawTarget.match(/^([^\s]+)(?:\s+"[^"]*")?$/)?.[1] || rawTarget
        const normalizedSource = normalizeImageSource(target)
        if (normalizedSource) {
            refs.push({ src: normalizedSource, alt: altText })
        }
    }

    const htmlImgPattern = /<img\b[^>]*>/gi
    for (const tagMatch of source.match(htmlImgPattern) || []) {
        const srcMatch = tagMatch.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
        if (!srcMatch) continue
        const altMatch = tagMatch.match(/\balt\s*=\s*["']([^"']*)["']/i)
        const style = tagMatch.match(/\bstyle\s*=\s*["']([^"']*)["']/i)?.[1] || ''
        const styleWidth = /(?:^|;)\s*width\s*:\s*([\d.]+)\s*(px|%)/i.exec(style)
        const attributeWidth = /\bwidth\s*=\s*["']?([\d.]+)(px|%)?/i.exec(tagMatch)
        const widthMatch = styleWidth || attributeWidth
        const centered = /(?:^|;)\s*margin-left\s*:\s*auto\s*(?:;|$)/i.test(style)
            && /(?:^|;)\s*margin-right\s*:\s*auto\s*(?:;|$)/i.test(style)
        const rightAligned = !centered && /(?:^|;)\s*margin-left\s*:\s*auto\s*(?:;|$)/i.test(style)
        const normalizedSource = normalizeImageSource(srcMatch[1])
        if (normalizedSource) {
            refs.push({
                src: normalizedSource,
                alt: String(altMatch?.[1] || '').trim(),
                isTemplateHeader: /template-header-image/i.test(tagMatch),
                requestedWidth: widthMatch
                    ? {
                        value: Number.parseFloat(widthMatch[1]),
                        unit: String(widthMatch[2] || 'px').toLowerCase(),
                    }
                    : null,
                alignment: centered ? 'center' : rightAligned ? 'right' : 'left',
            })
        }
    }

    return refs
}

function stripImageSyntaxFromLine(line) {
    return String(line || '')
        .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '')
        .replace(/<img\b[^>]*>/gi, '')
}

function getRasterImageDimensions(buffer, extension) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null

    const normalizedExtension = String(extension || '').toLowerCase()
    if (normalizedExtension === 'png' && buffer.length >= 24) {
        const width = buffer.readUInt32BE(16)
        const height = buffer.readUInt32BE(20)
        return width > 0 && height > 0 ? { width, height } : null
    }

    if (normalizedExtension === 'gif') {
        const width = buffer.readUInt16LE(6)
        const height = buffer.readUInt16LE(8)
        return width > 0 && height > 0 ? { width, height } : null
    }

    if (normalizedExtension === 'jpg' || normalizedExtension === 'jpeg') {
        let offset = 2
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset += 1
                continue
            }

            const marker = buffer[offset + 1]
            if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
                offset += 2
                continue
            }

            const segmentLength = buffer.readUInt16BE(offset + 2)
            if (segmentLength < 2 || offset + segmentLength + 2 > buffer.length) break

            const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
                || (marker >= 0xc5 && marker <= 0xc7)
                || (marker >= 0xc9 && marker <= 0xcb)
                || (marker >= 0xcd && marker <= 0xcf)
            if (isStartOfFrame) {
                const height = buffer.readUInt16BE(offset + 5)
                const width = buffer.readUInt16BE(offset + 7)
                return width > 0 && height > 0 ? { width, height } : null
            }

            offset += segmentLength + 2
        }
    }

    return null
}

function getWordImageExtent(imageAsset, requestedWidth = null) {
    const dimensions = getRasterImageDimensions(imageAsset?.buffer, imageAsset?.extension)
    if (!dimensions) {
        return { cx: 5486400, cy: 3086100 }
    }

    const emuPerPixel = 9525
    const maxWidthEmu = 5943600
    const maxHeightEmu = 7772400
    const naturalWidthEmu = dimensions.width * emuPerPixel
    const naturalHeightEmu = dimensions.height * emuPerPixel
    const requestedValue = Number(requestedWidth?.value)
    const requestedWidthEmu = Number.isFinite(requestedValue) && requestedValue > 0
        ? requestedWidth?.unit === '%'
            ? maxWidthEmu * Math.min(1, requestedValue / 100)
            : maxWidthEmu * Math.min(1, requestedValue / 794)
        : naturalWidthEmu
    const scale = Math.min(
        requestedWidthEmu / naturalWidthEmu,
        maxWidthEmu / naturalWidthEmu,
        maxHeightEmu / naturalHeightEmu
    )

    return {
        cx: Math.max(1, Math.round(naturalWidthEmu * scale)),
        cy: Math.max(1, Math.round(naturalHeightEmu * scale)),
    }
}

async function resolveImageAsset(source) {
    const src = String(source || '').trim()
    if (!src) return null

    if (/^data:image\//i.test(src)) {
        const dataUriMatch = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/i)
        if (!dataUriMatch) return null

        const contentType = String(dataUriMatch[1] || '').toLowerCase()
        const extension = detectImageExtensionFromMime(contentType)
        if (!extension) return null

        const buffer = Buffer.from(String(dataUriMatch[2] || ''), 'base64')
        if (!buffer || buffer.length === 0) return null

        return {
            buffer,
            extension,
            contentType,
        }
    }

    if (/^https?:\/\//i.test(src)) {
        try {
            const response = await fetch(src, { cache: 'no-store' })
            if (!response.ok) return null

            const arrayBuffer = await response.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)
            if (!buffer || buffer.length === 0) return null

            const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
            const extension = detectImageExtensionFromMime(contentType)
            if (!extension) return null

            return {
                buffer,
                extension,
                contentType,
            }
        } catch {
            return null
        }
    }

    if (src.startsWith('/')) {
        try {
            const absolutePath = resolvePublicImageAbsolutePath(src)
            if (!absolutePath) return null

            const extensionWithDot = path.extname(absolutePath).toLowerCase()
            const contentType = contentTypeFromImageExtension(extensionWithDot)
            if (!contentType) return null

            const extension = detectImageExtensionFromMime(contentType)
            if (!extension) return null

            const buffer = await readFile(absolutePath)
            if (!buffer || buffer.length === 0) return null

            return {
                buffer,
                extension,
                contentType,
            }
        } catch {
            return null
        }
    }

    return null
}

async function buildWordBodyXmlWithImages(markdown, { skipTemplateHeaderImages = false } = {}) {
    const source = String(markdown || '').replace(/\r\n/g, '\n')
    if (!source.trim()) {
        return {
            xml: '',
            mediaFiles: [],
            relationships: [],
            imageContentTypes: new Map(),
        }
    }

    const lines = source.split('\n')
    const xmlBlocks = []
    const mediaFiles = []
    const relationships = []
    const imageContentTypes = new Map()

    let relationshipCounter = 1
    let imageCounter = 0
    let docPrCounter = 1
    let textBuffer = []

    const flushTextBuffer = () => {
        if (textBuffer.length === 0) return
        const chunkXml = toWordParagraphXmlFromBlocks(textBuffer.join('\n'))
        if (chunkXml) {
            xmlBlocks.push(chunkXml)
        }
        textBuffer = []
    }

    for (const line of lines) {
        const lineImageRefs = extractImageRefsFromLine(line)
        // A running branded header already carries the practice logo; rendering the copy lifted
        // from the report template in the body would show it twice on page one.
        const imageRefs = skipTemplateHeaderImages
            ? lineImageRefs.filter((ref) => !ref.isTemplateHeader)
            : lineImageRefs
        if (imageRefs.length === 0 && lineImageRefs.length === 0) {
            textBuffer.push(line)
            continue
        }
        if (imageRefs.length === 0) {
            // The line held only the template header image.
            const textOnly = normalizeDanglingEmphasis(stripHtmlTags(stripImageSyntaxFromLine(line))).trim()
            if (textOnly) textBuffer.push(textOnly)
            continue
        }

        flushTextBuffer()

        const textOnly = normalizeDanglingEmphasis(stripHtmlTags(stripImageSyntaxFromLine(line))).trim()
        const pushTextBlock = () => {
            if (!textOnly) return
            const textXml = toWordParagraphXmlFromBlocks(textOnly)
            if (textXml) {
                xmlBlocks.push(textXml)
            }
        }
        // Keep the line's own order: a template header is one heading that opens with the
        // practice logo, so the picture belongs above the heading text, not below it.
        const imageFirst = imageLeadsLine(line)
        if (!imageFirst) pushTextBlock()

        for (const imageRef of imageRefs) {
            const imageAsset = await resolveImageAsset(imageRef.src)
            if (!imageAsset) continue

            imageCounter += 1
            relationshipCounter += 1

            const fileName = `image${imageCounter}.${imageAsset.extension}`
            const relId = `rId${relationshipCounter}`

            mediaFiles.push({
                path: `word/media/${fileName}`,
                buffer: imageAsset.buffer,
            })
            relationships.push({
                id: relId,
                type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
                target: `media/${fileName}`,
            })
            imageContentTypes.set(imageAsset.extension, imageAsset.contentType)
            xmlBlocks.push(buildWordImageParagraphXml({
                relationshipId: relId,
                docPrId: docPrCounter,
                altText: imageRef.alt,
                extent: getWordImageExtent(imageAsset, imageRef.requestedWidth),
                alignment: imageRef.alignment,
            }))
            docPrCounter += 1
        }

        if (imageFirst) pushTextBlock()
    }

    flushTextBuffer()

    return {
        xml: xmlBlocks.join(''),
        mediaFiles,
        relationships,
        imageContentTypes,
    }
}

function decodeHtmlEntities(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
}

function stripHtmlTags(value) {
    const withoutTags = String(value || '').replace(/<[^>]+>/g, ' ')
    const decoded = decodeHtmlEntities(withoutTags)
    return decoded.replace(/\s+/g, ' ').trim()
}

function normalizeDanglingEmphasis(value) {
    return String(value || '')
        .replace(/(\*\*[^\n*]+\*\*)\*{2,}(?=\s*$)/g, '$1')
        .replace(/(__[^\n_]+__)_{2,}(?=\s*$)/g, '$1')
        .replace(/[*_]{4,}(?=\s*$)/g, '')
        .trimEnd()
}

function tableCellPlainText(value) {
    return normalizeDanglingEmphasis(stripHtmlTags(value))
}

function tableCellTextLines(value) {
    const withLineBreaks = String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|li)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')

    return decodeHtmlEntities(withLineBreaks)
        .split('\n')
        .map((line) => normalizeDanglingEmphasis(line.replace(/\s+/g, ' ').trim()))
        .filter(Boolean)
}

function buildWordTableCellParagraphXml(text, { listType = '', index = 1, bold = false } = {}) {
    const source = String(text || '').trim() || ' '
    if (listType) {
        const marker = listType === 'ordered' ? `${index}. ` : '• '
        return `<w:p><w:pPr><w:ind w:left="360" w:hanging="240"/><w:spacing w:after="40"/></w:pPr>${buildWordRunXml(`${marker}${source}`, { bold })}</w:p>`
    }
    // Table cells must stay tight: the document-level default paragraph spacing
    // (see `docxWordStyles`) would otherwise inflate every row.
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${buildWordRunXml(source, { bold })}</w:p>`
}

function buildWordTableCellContentXml(value, { bold = false } = {}) {
    const source = String(value || '')
    const blocks = []
    const blockPattern = /<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>|<(p|div)\b[^>]*>([\s\S]*?)<\/\3>/gi
    let match

    while ((match = blockPattern.exec(source)) !== null) {
        if (match[1]) {
            const listType = match[1].toLowerCase() === 'ol' ? 'ordered' : 'unordered'
            const items = Array.from(match[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi))
                .map((item) => tableCellPlainText(item[1]))
                .filter(Boolean)
            items.forEach((item, index) => {
                blocks.push(buildWordTableCellParagraphXml(item, { listType, index: index + 1, bold }))
            })
            continue
        }

        const lines = tableCellTextLines(match[4])
        const isUnordered = lines.length > 1 && lines.every((line) => /^[-*+]\s+\S/.test(line))
        const isOrdered = lines.length > 1 && lines.every((line) => /^\d+[.)]\s+\S/.test(line))

        if (isUnordered || isOrdered) {
            lines.forEach((line, index) => {
                const text = line.replace(isOrdered ? /^\d+[.)]\s+/ : /^[-*+]\s+/, '')
                blocks.push(buildWordTableCellParagraphXml(text, {
                    listType: isOrdered ? 'ordered' : 'unordered',
                    index: index + 1,
                    bold,
                }))
            })
        } else if (lines.length > 0) {
            blocks.push(buildWordTableCellParagraphXml(lines.join(' '), { bold }))
        }
    }

    if (blocks.length > 0) return blocks.join('')

    const lines = tableCellTextLines(source)
    const isUnordered = lines.length > 1 && lines.every((line) => /^[-*+]\s+\S/.test(line))
    const isOrdered = lines.length > 1 && lines.every((line) => /^\d+[.)]\s+\S/.test(line))
    if (isUnordered || isOrdered) {
        return lines.map((line, index) => buildWordTableCellParagraphXml(
            line.replace(isOrdered ? /^\d+[.)]\s+/ : /^[-*+]\s+/, ''),
            { listType: isOrdered ? 'ordered' : 'unordered', index: index + 1, bold }
        )).join('')
    }

    return buildWordTableCellParagraphXml(lines.join(' '), { bold })
}

const WORD_TABLE_BORDER_SIDES = ['top', 'left', 'bottom', 'right']

function parseCssCellBorders(style) {
    const source = String(style || '')
    const borders = {}
    let found = false

    for (const side of WORD_TABLE_BORDER_SIDES) {
        const declaration = new RegExp(`(?:^|;)\\s*border-${side}\\s*:\\s*([^;]+)`, 'i').exec(source)?.[1]?.trim()
        if (!declaration) continue
        found = true

        if (/^(?:0|none)(?:\s|$)/i.test(declaration)) {
            borders[side] = { val: 'nil', size: 0, color: 'auto' }
            continue
        }

        const widthPt = Number.parseFloat(/([\d.]+)\s*pt/i.exec(declaration)?.[1] || '0.5')
        const cssStyle = /\b(double|dashed|dotted|solid)\b/i.exec(declaration)?.[1]?.toLowerCase() || 'solid'
        const color = /#([0-9a-f]{3,8})\b/i.exec(declaration)?.[1] || '000000'
        borders[side] = {
            val: cssStyle === 'solid' ? 'single' : cssStyle,
            size: Math.max(1, Math.round(widthPt * 8)),
            color: color.length === 3
                ? color.split('').map((character) => character.repeat(2)).join('').toUpperCase()
                : color.slice(0, 6).toUpperCase(),
        }
    }

    return found ? borders : null
}

function buildWordCellBordersXml(borders) {
    if (!borders) {
        return '<w:tcBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="6" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="6" w:space="0" w:color="808080"/></w:tcBorders>'
    }

    const sidesXml = WORD_TABLE_BORDER_SIDES.map((side) => {
        const border = borders[side] || { val: 'nil', size: 0, color: 'auto' }
        return `<w:${side} w:val="${border.val}" w:sz="${border.size}" w:space="0" w:color="${border.color}"/>`
    }).join('')
    return `<w:tcBorders>${sidesXml}</w:tcBorders>`
}

function normalizeTableCell(cell) {
    const source = cell && typeof cell === 'object' && !Array.isArray(cell)
        ? cell
        : { content: cell }
    const colspan = Number.parseInt(String(source.colspan || '1'), 10)
    const rowspan = Number.parseInt(String(source.rowspan || '1'), 10)

    return {
        content: String(source.content || ''),
        colspan: Number.isFinite(colspan) ? Math.min(50, Math.max(1, colspan)) : 1,
        rowspan: Number.isFinite(rowspan) ? Math.min(100, Math.max(1, rowspan)) : 1,
        isHeader: source.isHeader === true,
        borders: source.borders || null,
    }
}

function layoutTableRows(rows, declaredColumnCount = 0) {
    const activeMerges = []
    let columnCount = 0

    const layoutRows = rows.map((row) => {
        const cells = row.map(normalizeTableCell)
        const entries = []
        let cellIndex = 0
        let columnIndex = 0

        while (cellIndex < cells.length || columnIndex < activeMerges.length) {
            const activeMerge = activeMerges[columnIndex]
            if (activeMerge?.startColumn === columnIndex) {
                entries.push({
                    ...activeMerge.cell,
                    content: '',
                    startColumn: columnIndex,
                    vMerge: 'continue',
                })

                activeMerge.remaining -= 1
                if (activeMerge.remaining <= 0) {
                    for (let offset = 0; offset < activeMerge.cell.colspan; offset += 1) {
                        activeMerges[columnIndex + offset] = null
                    }
                }
                columnIndex += activeMerge.cell.colspan
                continue
            }

            if (activeMerge?.coveredBy !== undefined) {
                columnIndex += 1
                continue
            }

            if (cellIndex >= cells.length) {
                columnIndex += 1
                continue
            }

            const cell = cells[cellIndex]
            cellIndex += 1
            const availableColumns = declaredColumnCount > 0
                ? Math.max(1, declaredColumnCount - columnIndex)
                : cell.colspan
            const effectiveColspan = Math.min(cell.colspan, availableColumns)
            const entry = {
                ...cell,
                colspan: effectiveColspan,
                startColumn: columnIndex,
                vMerge: cell.rowspan > 1 ? 'restart' : '',
            }
            entries.push(entry)

            if (cell.rowspan > 1) {
                activeMerges[columnIndex] = {
                    startColumn: columnIndex,
                    remaining: cell.rowspan - 1,
                    cell: entry,
                }
                for (let offset = 1; offset < effectiveColspan; offset += 1) {
                    activeMerges[columnIndex + offset] = { coveredBy: columnIndex }
                }
            }

            columnIndex += effectiveColspan
        }

        while (activeMerges.length > 0 && !activeMerges[activeMerges.length - 1]) {
            activeMerges.pop()
        }
        columnCount = Math.max(columnCount, columnIndex)
        return entries
    })

    return { layoutRows, columnCount }
}

function buildWordTableXml(rows, tableLayout = {}) {
    const normalizedRows = Array.isArray(rows)
        ? rows
            .map((row) => (Array.isArray(row) ? row : []))
            .filter((row) => row.length > 0)
        : []
    if (normalizedRows.length === 0) return ''

    const declaredColumnCount = Array.isArray(tableLayout.columnPercentages)
        ? tableLayout.columnPercentages.length
        : 0
    const { layoutRows, columnCount: detectedColumnCount } = layoutTableRows(normalizedRows, declaredColumnCount)
    const columnCount = declaredColumnCount || detectedColumnCount
    if (columnCount <= 0) return ''

    const { tableWidth: tableWidthTwips, columnWidths: colWidths } = resolveWordTableWidths({
        columnCount,
        tableWidthPercentage: tableLayout.tableWidthPercentage,
        columnPercentages: tableLayout.columnPercentages,
    })

    const gridXml = `<w:tblGrid>${colWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`

    const tableRowsXml = layoutRows.map((row) => {
        const cellsXml = row
            .map((cell) => {
                const width = colWidths
                    .slice(cell.startColumn, cell.startColumn + cell.colspan)
                    .reduce((total, value) => total + value, 0)
                const gridSpanXml = cell.colspan > 1 ? `<w:gridSpan w:val="${cell.colspan}"/>` : ''
                const vMergeXml = cell.vMerge ? `<w:vMerge w:val="${cell.vMerge}"/>` : ''
                const shadingXml = cell.isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/>' : ''
                const contentXml = buildWordTableCellContentXml(cell.content, { bold: cell.isHeader })
                const cellBordersXml = buildWordCellBordersXml(cell.borders)
                return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${gridSpanXml}${vMergeXml}${shadingXml}${cellBordersXml}</w:tcPr>${contentXml}</w:tc>`
            })
            .join('')

        return `<w:tr>${cellsXml}</w:tr>`
    }).join('')

    return wrapWordTableXml(`<w:tbl><w:tblPr><w:tblW w:w="${tableWidthTwips}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="${REPORT_TABLE_CELL_MARGIN_TWIPS}" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="${REPORT_TABLE_CELL_MARGIN_TWIPS}" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="${REPORT_TABLE_BORDER_SIZE_EIGHTHS}" w:space="0" w:color="${REPORT_TABLE_BORDER_COLOR}"/><w:left w:val="single" w:sz="${REPORT_TABLE_BORDER_SIZE_EIGHTHS}" w:space="0" w:color="${REPORT_TABLE_BORDER_COLOR}"/><w:bottom w:val="single" w:sz="${REPORT_TABLE_BORDER_SIZE_EIGHTHS}" w:space="0" w:color="${REPORT_TABLE_BORDER_COLOR}"/><w:right w:val="single" w:sz="${REPORT_TABLE_BORDER_SIZE_EIGHTHS}" w:space="0" w:color="${REPORT_TABLE_BORDER_COLOR}"/><w:insideH w:val="single" w:sz="${REPORT_TABLE_BORDER_SIZE_EIGHTHS}" w:space="0" w:color="${REPORT_TABLE_BORDER_COLOR}"/><w:insideV w:val="single" w:sz="${REPORT_TABLE_BORDER_SIZE_EIGHTHS}" w:space="0" w:color="${REPORT_TABLE_BORDER_COLOR}"/></w:tblBorders></w:tblPr>${gridXml}${tableRowsXml}</w:tbl>`)
}

function parseHtmlTableRows(tableHtml) {
    const rows = []
    const tableSource = String(tableHtml || '')
    const layout = extractHtmlTableLayout(tableSource)
    if (!tableSource) return { rows, layout }

    const rowMatches = Array.from(tableSource.matchAll(/<tr\b[\s\S]*?<\/tr>/gi))
    for (const rowMatch of rowMatches) {
        const rowHtml = rowMatch[0]
        const rowIsHeader = isHtmlTableHeaderRow(tableSource, rowMatch.index)
        const cells = []
        const cellPattern = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi
        let cellMatch
        while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
            const attributes = cellMatch[2] || ''
            cells.push({
                content: cellMatch[3] || '',
                colspan: Number.parseInt(/\bcolspan\s*=\s*["']?(\d+)/i.exec(attributes)?.[1] || '1', 10),
                rowspan: Number.parseInt(/\browspan\s*=\s*["']?(\d+)/i.exec(attributes)?.[1] || '1', 10),
                isHeader: rowIsHeader || String(cellMatch[1] || '').toLowerCase() === 'h',
                borders: parseCssCellBorders(/\bstyle\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1] || ''),
            })
        }
        if (cells.length > 0) rows.push(cells)
    }

    return { rows, layout }
}

function parseMarkdownTableRows(lines, startIndex) {
    const rows = []
    let index = startIndex

    const dividerPattern = /^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/
    if (index + 1 >= lines.length || !dividerPattern.test(String(lines[index + 1] || ''))) {
        return { rows, nextIndex: startIndex }
    }

    const splitRow = (line) => {
        const raw = String(line || '').trim()
        if (!raw.includes('|')) return []
        const withoutEdges = raw.replace(/^\|/, '').replace(/\|$/, '')
        return withoutEdges.split('|').map((cell) => cell.trim())
    }

    const header = splitRow(lines[index])
    if (header.length === 0) {
        return { rows, nextIndex: startIndex }
    }
    rows.push(header.map((content) => ({ content, isHeader: true })))

    index += 2
    while (index < lines.length) {
        const candidate = String(lines[index] || '').trim()
        if (!candidate || !candidate.includes('|') || /^#{1,6}\s+/.test(candidate)) break
        const cells = splitRow(candidate)
        if (cells.length === 0) break
        rows.push(cells)
        index += 1
    }

    return { rows, nextIndex: index }
}

function toTodayIsoDate() {
    return new Date().toISOString().slice(0, 10)
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeMarkdownText(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim()
}

function splitPatientName(patientName) {
    const trimmed = String(patientName || '').trim()
    if (!trimmed) {
        return { firstName: '', lastName: '', fullName: '' }
    }

    const parts = trimmed.split(/\s+/).filter(Boolean)
    if (parts.length === 1) {
        return { firstName: parts[0], lastName: '', fullName: trimmed }
    }

    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(' '),
        fullName: trimmed,
    }
}

function firstNonEmptyString(...values) {
    for (const value of values) {
        const normalized = String(value || '').trim()
        if (normalized) return normalized
    }
    return ''
}

function extractAnswerFromMetadata(metadata, keyCandidates = [], labelCandidates = []) {
    if (!metadata || typeof metadata !== 'object') return ''

    const answers = metadata?.sploseAnswers && typeof metadata.sploseAnswers === 'object'
        ? metadata.sploseAnswers
        : {}
    const labelledAnswers = metadata?.sploseLabelledAnswers && typeof metadata.sploseLabelledAnswers === 'object'
        ? metadata.sploseLabelledAnswers
        : {}

    for (const key of keyCandidates) {
        const value = answers?.[key]
        const normalized = String(value || '').trim()
        if (normalized) return normalized
    }

    const normalizedLabelCandidates = labelCandidates
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)

    for (const [label, value] of Object.entries(labelledAnswers)) {
        const normalizedLabel = String(label || '').trim().toLowerCase()
        if (!normalizedLabel) continue
        if (!normalizedLabelCandidates.some((candidate) => normalizedLabel.includes(candidate))) continue
        const normalizedValue = String(value || '').trim()
        if (normalizedValue) return normalizedValue
    }

    return ''
}

function derivePatientTemplateProfile({ patientName, metadata }) {
    const fullName = firstNonEmptyString(
        extractAnswerFromMetadata(metadata, ['patient_full_name'], ['patient full name']),
        patientName
    )

    const claimNumber = extractAnswerFromMetadata(
        metadata,
        ['claim_or_reference_number', 'tac_claim_number', 'ndis_number'],
        ['claim number', 'reference number', 'ndis number']
    )
    const accidentDate = extractAnswerFromMetadata(
        metadata,
        ['accident_date_if_tac', 'accident_date'],
        ['accident date']
    )
    const dateOfBirth = extractAnswerFromMetadata(
        metadata,
        ['date_of_birth', 'dob'],
        ['date of birth']
    )

    const referrerFullName = firstNonEmptyString(
        extractAnswerFromMetadata(metadata, ['referrer_full_name'], ['referrer full name', 'full name']),
        metadata?.referrerName
    )
    const referrerNameParts = splitPatientName(referrerFullName)

    const providerDetails = firstNonEmptyString(
        metadata?.providerDetails,
        metadata?.provider,
        metadata?.practice,
        metadata?.clinicName
    )

    return {
        patientFullName: fullName,
        claimNumber,
        accidentDate,
        dateOfBirth,
        contactFirstName: referrerNameParts.firstName,
        contactLastName: referrerNameParts.lastName,
        contactRelationship: extractAnswerFromMetadata(
            metadata,
            ['referrer_relationship'],
            ['relationship']
        ),
        contactPhone: extractAnswerFromMetadata(
            metadata,
            ['referrer_phone', 'client_phone'],
            ['phone number', 'phone']
        ),
        providerDetails,
    }
}

async function readPatientTemplateProfile({ domain, patientId, fallbackPatientName = '' }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return derivePatientTemplateProfile({ patientName: fallbackPatientName, metadata: null })
    }

    let connection = null
    try {
        connection = await getDomainBoundConnection(domain)

        const result = await connection.query(
            'SELECT patient_name, metadata FROM patients WHERE domain = $1 AND id = $2 LIMIT 1',
            [domain, patientId]
        )
        const row = result?.rows?.[0] || null

        const metadata = parseJsonObject(row?.metadata)
        const resolvedName = firstNonEmptyString(row?.patient_name, fallbackPatientName)
        return derivePatientTemplateProfile({ patientName: resolvedName, metadata })
    } catch {
        return derivePatientTemplateProfile({ patientName: fallbackPatientName, metadata: null })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

function extractSectionByHeadingHints(markdown, headingHints = []) {
    const source = normalizeMarkdownText(markdown)
    if (!source) return ''

    const hints = headingHints
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    if (hints.length === 0) return ''

    const lines = source.split('\n')
    const headingPattern = /^#{1,6}\s+(.+)$/
    let startIndex = -1

    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(headingPattern)
        if (!match) continue
        const heading = String(match[1] || '').trim().toLowerCase()
        if (hints.some((hint) => heading.includes(hint))) {
            startIndex = index + 1
            break
        }
    }

    if (startIndex < 0) return ''

    const sectionLines = []
    for (let index = startIndex; index < lines.length; index += 1) {
        if (headingPattern.test(lines[index])) break
        sectionLines.push(lines[index])
    }

    return sectionLines.join('\n').trim()
}

function extractFirstMarkdownTable(markdown) {
    const source = normalizeMarkdownText(markdown)
    if (!source) return ''

    const lines = source.split('\n')
    const dividerPattern = /^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/

    for (let index = 0; index < lines.length - 1; index += 1) {
        const header = lines[index]
        const divider = lines[index + 1]
        if (!header.includes('|')) continue
        if (!dividerPattern.test(divider)) continue

        const tableLines = [header, divider]
        let rowIndex = index + 2
        while (rowIndex < lines.length && lines[rowIndex].includes('|')) {
            tableLines.push(lines[rowIndex])
            rowIndex += 1
        }

        return tableLines.join('\n').trim()
    }

    return ''
}

function extractBulletItems(markdown) {
    const source = normalizeMarkdownText(markdown)
    if (!source) return []

    return source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line))
        .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
        .filter(Boolean)
}

const OTF10_TABLE_CELL_STYLE = 'border-top: 0.5pt solid #1E2850; border-left: 0.5pt solid #1E2850; border-bottom: 0.5pt solid #1E2850; border-right: 0.5pt solid #1E2850'

function htmlTableRowsFromItems(items = [], columnCount = 5) {
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : []
    if (safeItems.length === 0) return ''

    return safeItems.map((item) => {
        const escaped = xmlEscape(String(item))
        const columns = [escaped]
        while (columns.length < columnCount) {
            columns.push('')
        }
        const cellsXml = columns.map((column) => `<td style="${OTF10_TABLE_CELL_STYLE}"><p>${column}</p></td>`).join('')
        return `<tr>${cellsXml}</tr>`
    }).join('')
}

function replaceHtmlTemplatePlaceholder(templateSource, placeholder, value) {
    const source = String(templateSource || '')
    const replacement = String(value || '')
    if (!source.includes(placeholder)) return source

    const tokenName = String(placeholder).replace(/[{}\s]/g, '')
    if (replacement && /_rows$/i.test(tokenName)) {
        const escapedPlaceholder = String(placeholder).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const tableBodyPattern = new RegExp(
            `(<tbody\\b[^>]*>)(?:(?!<\\/tbody>)[\\s\\S])*?${escapedPlaceholder}(?:(?!<\\/tbody>)[\\s\\S])*?(<\\/tbody>)`,
            'gi'
        )
        const withReplacedTableBody = source.replace(tableBodyPattern, `$1\n${replacement}\n$2`)
        if (withReplacedTableBody !== source) {
            return withReplacedTableBody
        }
    }

    return source.split(placeholder).join(replacement)
}

function buildOtf6DerivedPlaceholderMap(reportMarkdown) {
    const source = normalizeMarkdownText(reportMarkdown)
    const fallbackText = source

    const referralContext = extractSectionByHeadingHints(source, ['referral context'])
    const clinicalNotes = extractSectionByHeadingHints(source, ['clinical notes'])
    const functionalSnapshot = extractSectionByHeadingHints(source, ['functional capacity snapshot'])
    const environmentalFactors = extractSectionByHeadingHints(source, ['environmental factors'])
    const safetyRisk = extractSectionByHeadingHints(source, ['safety / risk', 'safety'])
    const assessmentDraft = extractSectionByHeadingHints(source, ['assessment draft'])
    const recommendationsDraft = extractSectionByHeadingHints(source, ['plan / recommendations draft', 'recommendations'])
    const firstMarkdownTable = extractFirstMarkdownTable(functionalSnapshot || source)

    const recommendationItems = extractBulletItems(recommendationsDraft)
    const assessmentItems = extractBulletItems(assessmentDraft)

    return {
        '{{injuries_accident_related}}': clinicalNotes || referralContext || fallbackText,
        '{{injuries_other_or_preexisting}}': referralContext || clinicalNotes || '',
        '{{current_function_summary}}': functionalSnapshot || clinicalNotes || fallbackText,
        '{{current_home_living_social}}': environmentalFactors || referralContext || '',
        '{{home_environment}}': environmentalFactors || '',
        '{{cultural_personal_considerations}}': referralContext || '',
        '{{functional_personal_care}}': functionalSnapshot || clinicalNotes || '',
        '{{functional_domestic_tasks}}': functionalSnapshot || recommendationsDraft || '',
        '{{functional_community_participation}}': functionalSnapshot || referralContext || '',
        '{{functional_work_education}}': functionalSnapshot || '',
        '{{functional_safety}}': safetyRisk || recommendationsDraft || '',
        '{{assessment_tools_used}}': 'Transcript review, clinician interview, and functional observation summary.',
        '{{goals_table_rows}}': htmlTableRowsFromItems(recommendationItems.slice(0, 5), 5),
        '{{goals_total_hours}}': '',
        '{{other_ot_rows}}': htmlTableRowsFromItems(assessmentItems.slice(0, 4), 4),
        '{{other_ot_total_hours}}': '',
        '{{non_ot_supports_needed}}': recommendationItems.length > 0 ? 'Yes' : 'No',
        '{{non_ot_supports_rows}}': htmlTableRowsFromItems(recommendationItems.slice(0, 4), 2),
        '{{hours_goals}}': '',
        '{{hours_other_ot}}': '',
        '{{hours_travel}}': '',
        '{{proposed_commencement_date}}': '',
        '{{proposed_funding_end_date}}': '',
        '{{provider_details}}': '',
        '{{privacy_statement}}': '',
        '{{functional_capacity_snapshot_table}}': firstMarkdownTable,
    }
}

function buildOtf10DerivedPlaceholderMap(reportMarkdown) {
    const source = normalizeMarkdownText(reportMarkdown)
    const fallbackText = source
    const review = extractSectionByHeadingHints(source, ['review of home services'])
    const recommendations = extractSectionByHeadingHints(source, ['recommendations', 'funded support', 'additional ot funding'])
    const equipment = extractSectionByHeadingHints(source, ['assistive technology', 'equipment'])
    const summary = extractSectionByHeadingHints(source, ['summary of plan', 'summary'])
    const referral = extractSectionByHeadingHints(source, ['further assessment', 'intervention', 'referrals'])
    const reviewItems = extractBulletItems(review || fallbackText)
    const recommendationItems = extractBulletItems(recommendations || fallbackText)

    return {
        '{{review_date}}': toTodayIsoDate(),
        '{{initial_home_services_assessment_date}}': '',
        '{{contributors_rows}}': htmlTableRowsFromItems(reviewItems.slice(0, 3), 3),
        '{{household_goals}}': review || fallbackText,
        '{{social_situation_changes}}': '',
        '{{social_situation_changes_detail}}': review || '',
        '{{functional_capacity_changes}}': review || fallbackText,
        '{{information_source}}': 'Client/family report, provider information, and review of available records.',
        '{{injury_related_changes}}': review || fallbackText,
        '{{household_member_capacity_changes}}': '',
        '{{household_member_capacity_details}}': review || '',
        '{{cultural_considerations}}': review || '',
        '{{funded_support_rows}}': htmlTableRowsFromItems(recommendationItems.slice(0, 3), 3),
        '{{assistive_technology_rows}}': htmlTableRowsFromItems(extractBulletItems(equipment || '').slice(0, 4), 4),
        '{{quotation_details}}': '',
        '{{additional_ot_funding_rows}}': htmlTableRowsFromItems(recommendationItems.slice(0, 2), 2),
        '{{summary_of_plan}}': summary || recommendations || fallbackText,
        '{{further_assessment_recommendation}}': referral || '',
        '{{days_hours_available}}': '',
        '{{provider_date}}': toTodayIsoDate(),
        '{{privacy_statement}}': '',
    }
}

function buildTemplatePlaceholderMap({ patientName, patientId, domain, practiceName = '', reportText, reportMarkdown, patientProfile = null, reportConfig = null }) {
    const resolvedFullName = firstNonEmptyString(patientProfile?.patientFullName, patientName)
    const { firstName, lastName, fullName } = splitPatientName(resolvedFullName)
    const normalizedReportText = normalizeMarkdownText(reportText)
    const normalizedReportMarkdown = normalizeMarkdownText(reportMarkdown)
    const otf6Derived = buildOtf6DerivedPlaceholderMap(normalizedReportMarkdown || normalizedReportText)
    const otf10Derived = buildOtf10DerivedPlaceholderMap(normalizedReportMarkdown || normalizedReportText)
    const providerDetails = firstNonEmptyString(
        reportConfig?.providerDetails,
        patientProfile?.providerDetails,
        otf6Derived['{{provider_details}}']
    )
    const providerLines = String(providerDetails || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    const resolvedPracticeName = firstNonEmptyString(practiceName, reportConfig?.practiceName, domain)

    return {
        '{{patient_name}}': fullName,
        '{{patient_name_first}}': firstName,
        '{{patient_name_last}}': lastName,
        '{{patient_name_full}}': fullName,
        '{{patient_id}}': String(patientId || '').trim(),
        '{{domain}}': String(domain || '').trim(),
        '{{practice_name}}': resolvedPracticeName,
        '{{practice}}': resolvedPracticeName,
        '{{report_date}}': toTodayIsoDate(),
        '{{assessment_date}}': toTodayIsoDate(),
        '{{claim_number}}': firstNonEmptyString(patientProfile?.claimNumber),
        '{{ndis_number}}': firstNonEmptyString(patientProfile?.claimNumber),
        '{{accident_date}}': firstNonEmptyString(patientProfile?.accidentDate),
        '{{date_of_birth}}': firstNonEmptyString(patientProfile?.dateOfBirth),
        '{{contact_first_name}}': firstNonEmptyString(patientProfile?.contactFirstName),
        '{{contact_last_name}}': firstNonEmptyString(patientProfile?.contactLastName),
        '{{contact_relationship}}': firstNonEmptyString(patientProfile?.contactRelationship),
        '{{contact_phone}}': firstNonEmptyString(patientProfile?.contactPhone),
        '{{report_body}}': normalizedReportMarkdown || normalizedReportText,
        '{{generated_report_body}}': normalizedReportMarkdown || normalizedReportText,
        ...otf6Derived,
        ...otf10Derived,
        '{{provider_name}}': providerLines[0] || '',
        '{{provider_contact}}': providerLines.slice(1).join(' · '),
        '{{provider_details}}': providerDetails,
        '{{days_hours_available}}': firstNonEmptyString(reportConfig?.daysHoursAvailable, patientProfile?.daysHoursAvailable),
    }
}

function resolveLinkedTemplate(settings, reportType) {
    const templateId = String(reportType?.templateId || '').trim()
    if (!templateId) {
        throw new Error('Selected report type does not have a linked template')
    }

    const templates = Array.isArray(settings?.templates) ? settings.templates : []
    const template = templates.find((item) => String(item?.id || '').trim() === templateId)
    if (!template) {
        throw new Error('Linked report template was not found')
    }

    const contentBase64 = String(template?.contentBase64 || '').trim()
    if (!contentBase64) {
        throw new Error('Linked template content is empty')
    }

    return template
}

function appendWordParagraphs(documentXml, markdown) {
    const source = String(markdown || '').trim()
    if (!source) return documentXml

    const paragraphs = [
        '<w:p><w:r><w:t>Generated Report</w:t></w:r></w:p>',
        toWordParagraphXmlFromBlocks(source),
    ].join('')

    if (!documentXml.includes('</w:body>')) {
        throw new Error('Invalid DOCX template: missing document body end marker')
    }

    return documentXml.replace('</w:body>', `${paragraphs}</w:body>`)
}

function resolveReportTypeForTemplateExport(settings, requestedReportTypeId = '') {
    const reportTypes = Array.isArray(settings?.settings?.reportTypes) ? settings.settings.reportTypes : []
    if (reportTypes.length === 0) {
        throw new Error('No report types are configured')
    }

    const reportTypeId = String(requestedReportTypeId || settings?.settings?.config?.defaultReportTypeId || '').trim()
    const selected = reportTypeId
        ? reportTypes.find((item) => String(item?.id || '').trim() === reportTypeId)
        : null

    return selected || reportTypes[0]
}

function resolveLinkedDocxTemplate(settings, reportType) {
    const template = resolveLinkedTemplate(settings, reportType)

    const mimeType = String(template?.mimeType || '').trim().toLowerCase()
    if (mimeType !== DOCX_MIME_TYPE) {
        throw new Error('Linked template must be a DOCX file for template export')
    }

    const contentBase64 = String(template?.contentBase64 || '').trim()
    if (!contentBase64) {
        throw new Error('Linked DOCX template content is empty')
    }

    return template
}

function isLikelyMarkdownTemplate(template) {
    const mimeType = String(template?.mimeType || '').trim().toLowerCase()
    if (MARKDOWN_TEMPLATE_MIME_TYPES.has(mimeType)) {
        return true
    }

    const fileName = String(template?.fileName || '').trim().toLowerCase()
    return fileName.endsWith('.md') || fileName.endsWith('.markdown') || fileName.endsWith('.txt')
}

function buildMarkdownFromTemplate({ templateText, reportType, patientName, patientId, domain, practiceName = '', reportMarkdown, patientProfile = null, reportConfig = null }) {
    const sourceTemplate = String(templateText || '')
    if (!sourceTemplate.trim()) {
        throw new Error('Linked markdown template is empty')
    }

    const requiredAnchors = normalizeRequiredAnchors(reportType?.requiredAnchors)
    if (requiredAnchors.length > 0) {
        const missingAnchors = findMissingAnchorsInText({
            requiredAnchors,
            sourceText: sourceTemplate,
        })
        if (missingAnchors.length > 0) {
            throw new Error(`Template is missing required anchor text: ${missingAnchors.join(', ')}`)
        }
    }

    const requiredPlaceholders = normalizeRequiredPlaceholders(reportType?.requiredPlaceholders)
    for (const placeholder of requiredPlaceholders) {
        if (!sourceTemplate.includes(placeholder)) {
            throw new Error(`Template is missing required placeholder: ${placeholder}`)
        }
    }

    const reportBodyMarkdown = String(reportMarkdown || '').trim()
    const placeholderMap = buildTemplatePlaceholderMap({
        patientName,
        patientId,
        domain,
        practiceName,
        reportText: reportBodyMarkdown,
        reportMarkdown: reportBodyMarkdown,
        patientProfile,
        reportConfig,
    })

    const reportBodyPlaceholders = ['{{report_body}}', '{{generated_report_body}}']

    let merged = sourceTemplate
    let replacedReportBody = false

    for (const placeholder of reportBodyPlaceholders) {
        if (!merged.includes(placeholder)) continue
        merged = merged.split(placeholder).join(reportBodyMarkdown)
        replacedReportBody = true
    }

    for (const [placeholder, value] of Object.entries(placeholderMap)) {
        if (reportBodyPlaceholders.includes(placeholder) && replacedReportBody) {
            continue
        }
        if (!merged.includes(placeholder)) continue
        merged = replaceHtmlTemplatePlaceholder(merged, placeholder, value)
        if (reportBodyPlaceholders.includes(placeholder)) {
            replacedReportBody = true
        }
    }

    if (!replacedReportBody && reportBodyMarkdown) {
        const separator = merged.trimEnd() ? '\n\n' : ''
        merged = `${merged.trimEnd()}${separator}${reportBodyMarkdown}`
    }

    return merged.replace(/\n{3,}/g, '\n\n').trim()
}

function injectReportBodyBlocks(documentXml, markdown) {
    const blocksXml = toWordParagraphXmlFromBlocks(markdown)
    if (!blocksXml) {
        return {
            documentXml,
            replaced: false,
        }
    }

    const paragraphPattern = /<w:p\b[\s\S]*?\{\{report_body\}\}[\s\S]*?<\/w:p>/
    if (paragraphPattern.test(documentXml)) {
        return {
            documentXml: documentXml.replace(paragraphPattern, blocksXml),
            replaced: true,
        }
    }

    return {
        documentXml,
        replaced: false,
    }
}

async function buildDocxFromStrictTemplate({ template, reportType, patientName, patientId, domain, practiceName = '', reportText, reportMarkdown, patientProfile = null, reportConfig = null }) {
    const templateBuffer = Buffer.from(String(template.contentBase64 || '').trim(), 'base64')
    if (!templateBuffer || templateBuffer.length === 0) {
        throw new Error('Linked DOCX template is empty')
    }

    const requiredAnchors = normalizeRequiredAnchors(reportType?.requiredAnchors)
    if (requiredAnchors.length > 0) {
        const extracted = await mammoth.extractRawText({ buffer: templateBuffer })
        const sourceText = String(extracted?.value || '')
        const missingAnchors = findMissingAnchorsInText({
            requiredAnchors,
            sourceText,
        })
        if (missingAnchors.length > 0) {
            throw new Error(`Template is missing required anchor text: ${missingAnchors.join(', ')}`)
        }
    }

    const zip = await JSZip.loadAsync(templateBuffer)
    const documentFile = zip.file('word/document.xml')
    if (!documentFile) {
        throw new Error('Invalid DOCX template: word/document.xml was not found')
    }

    let documentXml = await documentFile.async('string')
    const requiredPlaceholders = normalizeRequiredPlaceholders(reportType?.requiredPlaceholders)
    const placeholderMap = buildTemplatePlaceholderMap({
        patientName,
        patientId,
        domain,
        practiceName,
        reportText,
        reportMarkdown,
        patientProfile,
        reportConfig,
    })

    for (const placeholder of requiredPlaceholders) {
        if (!documentXml.includes(placeholder)) {
            throw new Error(`Template is missing required placeholder: ${placeholder}`)
        }
    }

    let replacedReportBody = false

    if (documentXml.includes('{{report_body}}')) {
        const injected = injectReportBodyBlocks(documentXml, reportMarkdown)
        documentXml = injected.documentXml
        replacedReportBody = injected.replaced
    }

    for (const [placeholder, value] of Object.entries(placeholderMap)) {
        if (placeholder === '{{report_body}}' && replacedReportBody) {
            continue
        }
        const escaped = xmlEscape(value)
        if (!documentXml.includes(placeholder)) continue
        documentXml = documentXml.split(placeholder).join(escaped)
        if (placeholder === '{{report_body}}') {
            replacedReportBody = true
        }
    }

    if (!replacedReportBody) {
        documentXml = appendWordParagraphs(documentXml, reportMarkdown)
    }

    zip.file('word/document.xml', documentXml)
    return zip.generateAsync({ type: 'nodebuffer' })
}

function toWordFileName({ patientName, patientId }) {
    const baseName = String(patientName || '').trim() || `patient-${patientId}`
    const normalized = baseName
        .replace(/[^A-Za-z0-9 _.-]+/g, '')
        .replace(/\s+/g, '-')
        .trim()
        .toLowerCase()
    const stem = normalized || `patient-${patientId}`
    return `${stem}-formal-report.docx`
}

function toTemplateWordFileName({ patientName, patientId }) {
    const baseName = String(patientName || '').trim() || `patient-${patientId}`
    const normalized = baseName
        .replace(/[^A-Za-z0-9 _.-]+/g, '')
        .replace(/\s+/g, '-')
        .trim()
        .toLowerCase()
    const stem = normalized || `patient-${patientId}`
    return `${stem}-template-report.docx`
}

export async function POST(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const domain = resolveScopedDomain(adminUser, payload?.domain)
        if (domain === null) {
            return NextResponse.json({ success: false, error: 'Forbidden: cannot export for requested domain' }, { status: 403 })
        }
        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }

        const patientId = normalizePatientId(payload?.patient_id || payload?.patientId)
        if (!patientId) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        const format = String(payload?.format || '').trim().toLowerCase()
        if (format !== 'word-docx' && format !== 'template-docx' && format !== 'template-markdown') {
            return NextResponse.json({ success: false, error: 'format must be word-docx, template-docx, or template-markdown' }, { status: 400 })
        }

        const patientName = normalizeText(payload?.patient_name || payload?.patientName, 240).trim()
        const practiceName = await readDomainPracticeName(domain).catch(() => '')
        const reportMarkdown = normalizeText(payload?.report_markdown || payload?.reportMarkdown, 250000)
        const reportText = toWordFriendlyText(reportMarkdown)
        if (!reportText) {
            return NextResponse.json({ success: false, error: 'Report content is empty' }, { status: 400 })
        }

        if (format === 'template-docx') {
            const settings = await readReportSettingsForDomain(domain)
            const reportType = resolveReportTypeForTemplateExport(settings, payload?.report_type_id || payload?.reportTypeId)
            const linkedTemplate = resolveLinkedDocxTemplate(settings, reportType)
            const patientProfile = await readPatientTemplateProfile({
                domain,
                patientId,
                fallbackPatientName: patientName,
            })
            const mergedDocx = await buildDocxFromStrictTemplate({
                template: linkedTemplate,
                reportType,
                patientName,
                patientId,
                domain,
                practiceName,
                reportText,
                reportMarkdown,
                patientProfile,
                reportConfig: settings?.settings?.config,
            })

            const fileName = toTemplateWordFileName({ patientName, patientId })
            return new NextResponse(mergedDocx, {
                status: 200,
                headers: {
                    'Content-Type': DOCX_MIME_TYPE,
                    'Content-Disposition': `attachment; filename="${fileName}"`,
                    'Cache-Control': 'no-store',
                },
            })
        }

        if (format === 'template-markdown') {
            const settings = await readReportSettingsForDomain(domain)
            const reportType = resolveReportTypeForTemplateExport(settings, payload?.report_type_id || payload?.reportTypeId)
            const linkedTemplate = resolveLinkedTemplate(settings, reportType)
            const patientProfile = await readPatientTemplateProfile({
                domain,
                patientId,
                fallbackPatientName: patientName,
            })

            if (!isLikelyMarkdownTemplate(linkedTemplate)) {
                return NextResponse.json(
                    {
                        success: false,
                        error: 'Selected report type is linked to a DOCX template. Link a markdown template to use editable template merge.',
                    },
                    { status: 400 }
                )
            }

            const templateBuffer = Buffer.from(String(linkedTemplate?.contentBase64 || '').trim(), 'base64')
            const templateText = templateBuffer.toString('utf8')
            const mergedMarkdown = buildMarkdownFromTemplate({
                templateText,
                reportType,
                patientName,
                patientId,
                domain,
                practiceName,
                reportMarkdown,
                patientProfile,
                reportConfig: settings?.settings?.config,
            })

            return NextResponse.json({
                success: true,
                format,
                reportTypeId: String(reportType?.id || '').trim(),
                reportTypeName: String(reportType?.name || '').trim(),
                templateId: String(linkedTemplate?.id || '').trim(),
                templateName: String(linkedTemplate?.name || '').trim(),
                mergedMarkdown,
            })
        }

        if (format === 'word-docx') {
            const fileName = toWordFileName({ patientName, patientId })
            let branding = null
            try {
                const settings = await readReportSettingsForDomain(domain)
                branding = buildReportBranding({ domain, settings, practiceName })
            } catch {
                // A settings read failure must not block the export; the domain logo still applies.
                branding = buildReportBranding({ domain, practiceName })
            }
            const docxBuffer = await buildSimpleDocxFromText(reportMarkdown, { branding })
            return new NextResponse(docxBuffer, {
                status: 200,
                headers: {
                    'Content-Type': DOCX_MIME_TYPE,
                    'Content-Disposition': `attachment; filename="${fileName}"`,
                    'Cache-Control': 'no-store',
                },
            })
        }

        return NextResponse.json({ success: false, error: 'Unsupported export format' }, { status: 400 })
    } catch (error) {
        const message = error?.message || 'Failed to export report'
        return NextResponse.json({ success: false, error: message }, { status: 500 })
    }
}

