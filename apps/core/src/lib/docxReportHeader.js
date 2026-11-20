// The WordprocessingML for a report's branded page header.
//
// Kept apart from the export route so the header can be tested as markup: the part is a standalone
// document with its own relationship file, and the geometry must match what the preview draws.

import {
    REPORT_HEADER_LOGO_GAP_TWIPS,
    REPORT_HEADER_RULE_COLOR,
    REPORT_HEADER_RULE_SIZE_EIGHTHS,
    REPORT_HEADER_RULE_SPACE_TWIPS,
    REPORT_HEADER_TEXT_COLOR,
    REPORT_HEADER_TEXT_HALF_POINTS,
} from './reportPageMetrics.js'

function xmlEscape(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function buildLogoRunXml({ relationshipId, extent, docPrId, altText }) {
    const cx = Math.max(1, Math.round(Number(extent?.cx) || 1))
    const cy = Math.max(1, Math.round(Number(extent?.cy) || 1))
    const safeAlt = xmlEscape(altText || 'Practice logo')

    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="Picture ${docPrId}" descr="${safeAlt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Picture ${docPrId}" descr="${safeAlt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${xmlEscape(relationshipId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
}

/**
 * Build the `word/header1.xml` part.
 *
 * `logoExtent` is in EMU and already preserves the logo's aspect ratio; the caller sizes it from
 * the shared header geometry. A text-only header still draws the rule, so the top of the page looks
 * the same whether or not the practice has a logo.
 */
export function buildReportHeaderXml({ logoRelationshipId = '', logoExtent = null, docPrId = 1, altText = '', text = '' } = {}) {
    const rulePoints = Math.max(0, Math.round(REPORT_HEADER_RULE_SPACE_TWIPS / 20))
    const hasLogo = Boolean(logoRelationshipId && logoExtent)
    const label = String(text || '').trim()

    const logoParagraph = hasLogo
        ? `<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="${REPORT_HEADER_LOGO_GAP_TWIPS}" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${buildLogoRunXml({ relationshipId: logoRelationshipId, extent: logoExtent, docPrId, altText })}</w:p>`
        : ''

    const textRun = label
        ? `<w:r><w:rPr><w:color w:val="${REPORT_HEADER_TEXT_COLOR}"/><w:sz w:val="${REPORT_HEADER_TEXT_HALF_POINTS}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r>`
        : '<w:r><w:t xml:space="preserve"> </w:t></w:r>'

    const textParagraph = `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:pBdr><w:bottom w:val="single" w:sz="${REPORT_HEADER_RULE_SIZE_EIGHTHS}" w:space="${rulePoints}" w:color="${REPORT_HEADER_RULE_COLOR}"/></w:pBdr><w:jc w:val="center"/></w:pPr>${textRun}</w:p>`

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">${logoParagraph}${textParagraph}</w:hdr>`
}
