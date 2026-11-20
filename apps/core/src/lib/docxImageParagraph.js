// WordprocessingML for the image paragraphs the formal-report DOCX export emits
// (`src/app/api/database/patients/formal-report/export/route.js`).
//
// Kept in `src/lib` so the paragraph shape can be unit tested without booting Next.
//
// Every image in the report markdown is lifted out of its line into a paragraph of its own.
// That paragraph must not inherit the document's body leading: `docxWordStyles.js` sets an
// *exact* 14pt line for body text, and an exact line height cannot grow to the height of an
// inline graphic. Word then clips the picture, and readers that keep the drawn height instead
// (Google Docs, LibreOffice) draw it over the paragraph above — which is why the exported FCA
// header logo landed on top of the report title.
//
// `w:lineRule="auto"` with `w:line="240"` (single spacing) lets the line grow to the image, so
// the picture occupies its own height and pushes the following paragraph down. The paragraph
// spacing either side of the picture stays the body spacing so image and text keep the same
// rhythm as the rest of the report.

import {
    REPORT_BODY_SPACE_AFTER_TWIPS,
    REPORT_BODY_SPACE_BEFORE_TWIPS,
} from './reportPageMetrics.js'

// Word's unit for a single line when `w:lineRule="auto"`: 240 = one line.
export const WORD_IMAGE_LINE_TWIPS = 240

function xmlEscape(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

const IMAGE_MARKUP_PATTERN = /!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>/i

/**
 * Whether the line's first image comes before any report text.
 *
 * Images are lifted out of their line and written as separate block paragraphs, so the
 * converter has to decide whether the picture goes before or after the line's text. Template
 * headers are a single heading that starts with the practice logo
 * (`# <img src="...">Functional Capacity Assessment (NDIS)`); writing the heading text first
 * dropped the logo underneath the title, whereas the preview and the reference reports put it
 * above. A leading ATX heading marker (`# `) is not report text, so it does not count.
 */
export function imageLeadsLine(line) {
    const source = String(line || '')
    const firstImage = IMAGE_MARKUP_PATTERN.exec(source)
    if (!firstImage) return false

    const textBeforeImage = source
        .slice(0, firstImage.index)
        .replace(/^\s*#{1,6}\s+/, '')
        .trim()

    return textBeforeImage === ''
}

export function buildWordImageParagraphXml({ relationshipId, docPrId, altText = '', extent, alignment = 'left' }) {
    const cx = extent?.cx || 5486400
    const cy = extent?.cy || 3086100
    const safeAlt = xmlEscape(altText || 'Report image')
    const justification = alignment === 'center'
        ? '<w:jc w:val="center"/>'
        : alignment === 'right'
            ? '<w:jc w:val="right"/>'
            : ''
    const paragraphProperties = `<w:pPr><w:snapToGrid w:val="0"/><w:spacing w:before="${REPORT_BODY_SPACE_BEFORE_TWIPS}" w:after="${REPORT_BODY_SPACE_AFTER_TWIPS}" w:line="${WORD_IMAGE_LINE_TWIPS}" w:lineRule="auto"/>${justification}</w:pPr>`

    return `<w:p>${paragraphProperties}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="Picture ${docPrId}" descr="${safeAlt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Picture ${docPrId}" descr="${safeAlt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}
