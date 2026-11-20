'use client'

import { buildNoteRenderGroups } from '@/lib/noteDisplay'

// Read-only rendering of a note body (a ProseMirror/TipTap document flattened
// by `buildNoteRenderGroups`). Shared by the admin Notes page and the patient
// record panel so a note reads the same in both places.

function headingClasses(level) {
    if (level <= 1) return 'text-sm font-bold text-gray-900'
    if (level === 2) return 'text-sm font-semibold text-gray-900'
    return 'text-xs font-semibold uppercase tracking-wide text-gray-700'
}

function Block({ block }) {
    switch (block.kind) {
        case 'heading':
            return <p className={headingClasses(block.level)}>{block.text}</p>
        case 'quote':
            return (
                <p className="border-l-2 border-gray-300 pl-3 whitespace-pre-wrap text-xs italic text-gray-700">
                    {block.text}
                </p>
            )
        case 'code':
            return (
                <pre className="overflow-x-auto rounded-md bg-gray-50 px-3 py-2 text-[11px] text-gray-800">
                    {block.text}
                </pre>
            )
        case 'rule':
            return <hr className="border-gray-200" />
        case 'image':
            return (
                <p className="text-[11px] italic text-gray-400">
                    {block.alt ? `[image: ${block.alt}]` : '[image]'}
                </p>
            )
        case 'table':
            return (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-xs">
                        <tbody className="divide-y divide-gray-100">
                            {block.rows.map((row, rowIndex) => (
                                <tr key={`row-${rowIndex}`}>
                                    {row.map((cell, cellIndex) => (
                                        <td key={`cell-${rowIndex}-${cellIndex}`} className="px-2 py-1 text-gray-800">
                                            {cell || '—'}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )
        default:
            return <p className="whitespace-pre-wrap text-xs text-gray-800">{block.text}</p>
    }
}

function List({ group }) {
    // Bullets/numbers are rendered as text so the marker survives the list
    // being laid out as a plain block (and so task checkboxes read correctly).
    const ListTag = group.ordered ? 'ol' : 'ul'
    const style = { paddingLeft: `${0.75 + group.depth * 0.9}rem`, listStyleType: 'none' }

    return (
        <ListTag className="space-y-0.5 text-xs text-gray-800" style={style}>
            {group.items.map((item, index) => (
                <li key={item.key} className="whitespace-pre-wrap">
                    <span aria-hidden="true" className="mr-1.5 select-none text-gray-400">
                        {item.checked === null ? (group.ordered ? `${index + 1}.` : '•') : (item.checked ? '☑' : '☐')}
                    </span>
                    {item.text}
                </li>
            ))}
        </ListTag>
    )
}

export default function NoteBody({ content, className = '' }) {
    const groups = buildNoteRenderGroups(content)

    if (groups.length === 0) {
        return <p className="text-xs text-gray-500">This note has no readable body.</p>
    }

    return (
        <div className={`space-y-2 ${className}`}>
            {groups.map((group) => (
                group.type === 'list'
                    ? <List key={group.key} group={group} />
                    : <Block key={group.key} block={group.block} />
            ))}
        </div>
    )
}
