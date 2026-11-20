'use client'

import {
    PARTICIPANT_SOURCE_SENSITIVITY,
    normalizeParticipantSourceSelection,
    resolveParticipantSourceText,
} from './fcaParticipantSources.js'

// "Stored participant data" panel for the earlier builder steps.
//
// Every value here came from the participant's own record (intake form answers), so the clinician can
// see what the report will be built from instead of trusting a silent prefill. Two classes:
//
//   clinical - ticked by default; the text shown is what the builder uses as report context. The
//              step's own field remains the editing surface, so a value is never editable in two
//              places at once.
//   identity - shown for reference only. It never reaches the model (see fcaParticipantSources.js);
//              it is carried on the report as the identity glossary, and nothing restores it into the
//              report body yet.
//
// Ticking moves the text into the step's field, unticking removes it again while the field still
// holds the unedited value.

function ProvenanceChip({ children, tone = 'gray' }) {
    const tones = {
        gray: 'border-gray-200 bg-gray-50 text-gray-600',
        blue: 'border-blue-200 bg-blue-50 text-blue-700',
    }
    return (
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tones[tone] || tones.gray}`}>
            {children}
        </span>
    )
}

export default function ParticipantSourcesPanel({
    title = 'Stored participant data',
    rows,
    selection,
    onToggle,
    className = '',
}) {
    const list = Array.isArray(rows) ? rows : []
    if (list.length === 0) return null

    const normalized = normalizeParticipantSourceSelection(selection)
    const clinicalRows = list.filter((row) => row.sensitivity === PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL)
    const identityRows = list.filter((row) => row.sensitivity === PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY)

    return (
        <section className={`rounded-lg border border-gray-200 bg-gray-50 p-4 ${className}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                <ProvenanceChip tone="blue">{list.length} stored {list.length === 1 ? 'answer' : 'answers'}</ProvenanceChip>
            </div>
            <p className="mt-1 text-xs text-gray-600">
                Pulled from the participant&apos;s intake form. Identifiers stay out of the AI context and are added
                back when the report is rendered.
            </p>

            {clinicalRows.length > 0 && (
                <ul className="mt-3 space-y-3">
                    {clinicalRows.map((row) => {
                        const included = !normalized.excludedIds.includes(row.id)
                        const overridden = Object.prototype.hasOwnProperty.call(normalized.overrides, row.id)
                        const text = resolveParticipantSourceText(row, normalized)

                        return (
                            <li key={row.id} className="rounded-md border border-gray-200 bg-white p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-800">
                                        <input
                                            type="checkbox"
                                            checked={included}
                                            onChange={(event) => onToggle?.(row.id, event.target.checked)}
                                            className="h-3.5 w-3.5 rounded border-gray-300"
                                        />
                                        {row.label}
                                    </label>
                                    <ProvenanceChip>{row.provenance}</ProvenanceChip>
                                    {row.field && <ProvenanceChip tone="blue">{row.field}</ProvenanceChip>}
                                    {overridden && <ProvenanceChip tone="blue">edited</ProvenanceChip>}
                                </div>

                                <p title={text} className="mt-2 text-xs text-gray-700">
                                    {text.length > 180 ? `${text.slice(0, 180)}…` : text}
                                </p>

                                {!included && (
                                    <p className="mt-1.5 text-[11px] text-amber-700">
                                        Excluded from the report context.
                                    </p>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}

            {identityRows.length > 0 && (
                <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Kept out of the AI context
                    </p>
                    <ul className="mt-2 space-y-1.5">
                        {identityRows.map((row) => (
                            <li key={row.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                                <span className="font-medium text-gray-700">{row.label}:</span>
                                <span className="text-gray-600">{resolveParticipantSourceText(row, normalized)}</span>
                                <ProvenanceChip>{row.provenance}</ProvenanceChip>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    )
}
