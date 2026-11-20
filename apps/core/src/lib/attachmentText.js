// Attachment text extraction.
//
// One implementation of "what text can we get out of this stored file", so a file cannot classify
// one way in the picker and another way in a reader that consumes the same bytes.
//
// This module is server-only: it pulls in mammoth for DOCX conversion and the
// PDF.js build behind `unpdf` for PDFs. The picker UI must keep importing the
// pure helpers from `fcaAttachments.js` instead, so neither enters a client
// bundle.

import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'
import {
    classifyAttachmentTextSource,
    truncateAttachmentText,
    MAX_ATTACHMENT_TEXT_CHARS,
} from './fcaAttachments.js'

/** Text was extracted. `text` may still be empty when the document holds no words. */
export const ATTACHMENT_TEXT_OK = 'ok'
/** Nothing was stored for this file (zero bytes). */
export const ATTACHMENT_TEXT_EMPTY = 'empty'
/** The file cannot be read as text (image, recording, or a scan with no text layer). */
export const ATTACHMENT_TEXT_UNSUPPORTED = 'unsupported'
/** The file claims to be readable but conversion failed, for example a corrupt DOCX or PDF. */
export const ATTACHMENT_TEXT_UNREADABLE = 'unreadable'

/**
 * Normalise extracted text: drop the DOCX byte-order mark and NULs, standardise line endings,
 * strip trailing whitespace, and trim the result.
 */
export function cleanExtractedText(value) {
    return String(value || '')
        .replace(/^\uFEFF/, '')
        .replace(/\u0000/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .trim()
}

/** Accept a driver buffer or a raw value from `file_data`. */
export function toFileBuffer(fileData) {
    if (!fileData) return Buffer.alloc(0)
    if (Buffer.isBuffer(fileData)) return fileData
    return Buffer.from(fileData)
}

function resolveCharLimit(maxChars) {
    const limit = Number(maxChars)
    return Number.isFinite(limit) && limit > 0 ? limit : MAX_ATTACHMENT_TEXT_CHARS
}

/**
 * Read the text layer of a PDF.
 *
 * Pages are merged so a multi-page report reads as one document. A scanned PDF
 * carries no text layer, so this returns an empty string for it - the caller
 * treats that as "attach by name" rather than as an empty document, because a
 * silent empty attachment would look like the scan had been read.
 */
async function extractPdfText(bytes) {
    const document = await getDocumentProxy(new Uint8Array(bytes))
    const { text } = await extractText(document, { mergePages: true })
    return text
}

/**
 * Read the text of a stored patient file.
 *
 * Returns a status rather than throwing for the expected outcomes, so callers can tell "attach by
 * name" (`unsupported`) apart from "nothing was stored" (`empty`) and "this file is broken"
 * (`unreadable`) without parsing an error string.
 *
 * `truncated` and `originalLength` describe the cap rather than the caller's own budget: the text
 * is sliced to `maxChars`, and the caller can still report how much was dropped.
 *
 * A capped `text` ends with `ATTACHMENT_TRUNCATION_MARKER`. The marker is added here because this
 * is the layer that drops the characters: `serializeAttachmentContext` caps at the same 60,000
 * characters, so it sees a 60,000-character string and can never tell it was cut (an 8-page letter
 * was stored cut at exactly the cap with no marker at all, reading as if it ended mid-sentence).
 */
export async function extractAttachmentText({ mimeType, fileName, buffer, maxChars } = {}) {
    const source = classifyAttachmentTextSource(mimeType, fileName)

    if (source === 'binary') {
        return {
            source,
            status: ATTACHMENT_TEXT_UNSUPPORTED,
            text: '',
            truncated: false,
            originalLength: 0,
            error: `${fileName || 'This file'} cannot be read as text. It can still be attached as a named reference.`,
        }
    }

    const bytes = toFileBuffer(buffer)
    if (bytes.length === 0) {
        return {
            source,
            status: ATTACHMENT_TEXT_EMPTY,
            text: '',
            truncated: false,
            originalLength: 0,
            error: 'Stored file is empty',
        }
    }

    let raw
    try {
        if (source === 'docx') {
            raw = (await mammoth.extractRawText({ buffer: bytes }))?.value
        } else if (source === 'pdf') {
            raw = await extractPdfText(bytes)
        } else {
            raw = bytes.toString('utf8')
        }
    } catch (error) {
        return {
            source,
            status: ATTACHMENT_TEXT_UNREADABLE,
            text: '',
            truncated: false,
            originalLength: 0,
            error: error?.message || `${fileName || 'This file'} could not be read as text`,
        }
    }

    const text = cleanExtractedText(raw)

    // A PDF that parses but yields no text is a scan (or an image-only export). Reporting it as
    // read-but-empty would attach it with nothing behind it, so it stays a named reference.
    if (source === 'pdf' && !text) {
        return {
            source,
            status: ATTACHMENT_TEXT_UNSUPPORTED,
            text: '',
            truncated: false,
            originalLength: 0,
            error: `${fileName || 'This PDF'} has no text layer, so it may be a scan. It can still be attached as a named reference.`,
        }
    }

    const limit = resolveCharLimit(maxChars)
    const truncated = text.length > limit

    return {
        source,
        status: ATTACHMENT_TEXT_OK,
        text: truncated ? truncateAttachmentText(text, limit) : text,
        truncated,
        originalLength: text.length,
        error: null,
    }
}
