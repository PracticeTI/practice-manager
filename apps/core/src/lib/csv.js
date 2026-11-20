// Shared CSV helpers for the external-system import features.
//
// Kept free of Node-only APIs so the parser can also run in the browser for
// import previews.

// RFC 4180 parser: handles quoted fields, embedded commas, embedded newlines
// and doubled quotes ("") used as an escape.
export function parseCsv(text) {
    const source = String(text === undefined || text === null ? '' : text).replace(/^\uFEFF/, '')
    const rows = []
    let row = []
    let field = ''
    let inQuotes = false

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index]

        if (inQuotes) {
            if (char === '"') {
                if (source[index + 1] === '"') {
                    field += '"'
                    index += 1
                } else {
                    inQuotes = false
                }
            } else {
                field += char
            }
            continue
        }

        if (char === '"') {
            inQuotes = true
        } else if (char === ',') {
            row.push(field)
            field = ''
        } else if (char === '\r') {
            // handled by the \n case (or ignored for lone CR)
        } else if (char === '\n') {
            row.push(field)
            rows.push(row)
            row = []
            field = ''
        } else {
            field += char
        }
    }

    if (field !== '' || row.length > 0) {
        row.push(field)
        rows.push(row)
    }

    return rows.filter((cells) => cells.some((cell) => String(cell === undefined || cell === null ? '' : cell).trim() !== ''))
}

/**
 * Reduce an export header to a lookup key.
 *
 * Splose-shaped exports use a `(s)` suffix to mark a plural ("Patient(s)"),
 * which is stripped rather than replaced so a single alias entry covers both
 * spellings.
 */
export function normalizeCsvHeader(rawHeader) {
    return String(rawHeader === undefined || rawHeader === null ? '' : rawHeader)
        .toLowerCase()
        .replace(/\(s\)/g, '')
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}
