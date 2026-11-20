function parsePercentageWidth(style) {
    const match = /(?:^|;)\s*width\s*:\s*([\d.]+)\s*%/i.exec(String(style || ''))
    const value = Number.parseFloat(match?.[1] || '')
    return Number.isFinite(value) && value > 0 ? value : null
}

export function wrapWordTableXml(tableXml) {
    const spacerXml = '<w:p><w:pPr><w:spacing w:after="120" w:line="1" w:lineRule="exact"/></w:pPr></w:p>'
    return `${spacerXml}${String(tableXml || '')}${spacerXml}`
}

export function extractHtmlTableLayout(tableHtml) {
    const source = String(tableHtml || '')
    const tableAttributes = /<table\b([^>]*)>/i.exec(source)?.[1] || ''
    const tableStyle = /\bstyle\s*=\s*["']([^"']*)["']/i.exec(tableAttributes)?.[1] || ''
    const colgroup = /<colgroup\b[^>]*>([\s\S]*?)<\/colgroup>/i.exec(source)?.[1] || ''
    const columnPercentages = Array.from(colgroup.matchAll(/<col\b([^>]*)>/gi), (match) => {
        const style = /\bstyle\s*=\s*["']([^"']*)["']/i.exec(match[1] || '')?.[1] || ''
        return parsePercentageWidth(style)
    }).filter((value) => value !== null)

    return {
        tableWidthPercentage: parsePercentageWidth(tableStyle) || 100,
        columnPercentages,
    }
}

export function isHtmlTableHeaderRow(tableHtml, rowOffset) {
    const sourceBeforeRow = String(tableHtml || '').slice(0, Math.max(0, rowOffset)).toLowerCase()
    return sourceBeforeRow.lastIndexOf('<thead') > sourceBeforeRow.lastIndexOf('</thead>')
}

export function resolveWordTableWidths({ columnCount, tableWidthTwips = 9360, tableWidthPercentage = 100, columnPercentages = [] }) {
    const safeColumnCount = Math.max(0, Number.parseInt(String(columnCount || 0), 10) || 0)
    if (safeColumnCount === 0) return { tableWidth: 0, columnWidths: [] }

    const safeTablePercentage = Number.isFinite(tableWidthPercentage) && tableWidthPercentage > 0
        ? Math.min(100, tableWidthPercentage)
        : 100
    const tableWidth = Math.max(safeColumnCount, Math.round(tableWidthTwips * safeTablePercentage / 100))
    const usablePercentages = columnPercentages.length === safeColumnCount
        && columnPercentages.every((value) => Number.isFinite(value) && value > 0)
        ? columnPercentages
        : Array.from({ length: safeColumnCount }, () => 1)
    const totalPercentage = usablePercentages.reduce((total, value) => total + value, 0)
    let allocatedWidth = 0
    const columnWidths = usablePercentages.map((percentage, index) => {
        if (index === usablePercentages.length - 1) return tableWidth - allocatedWidth
        const width = Math.max(1, Math.round(tableWidth * percentage / totalPercentage))
        allocatedWidth += width
        return width
    })

    return { tableWidth, columnWidths }
}