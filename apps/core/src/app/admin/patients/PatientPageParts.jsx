'use client'
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Papa from 'papaparse'
import AssistantAvatar from '@/admin-ui/components/AssistantAvatar'
import { classifyAttachmentTextSource } from '@/lib/fcaAttachments'
import { getSupplierLogoUrl } from '@/lib/equipmentDirectory'
import { getPatientFilePreviewKind } from './patientMedia'
import { CSV_PREVIEW_ROW_LIMIT } from './patientPageConfig'
import { formatApproximateFileSize } from './patientUtils'

export function  getSupplierInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean)
    return words.length > 0 ? words.slice(0, 2).map((word) => word[0].toUpperCase()).join('') : '?'
}

export function  SourcingSupplierLogo({ supplier }) {
    const [failed, setFailed] = useState(false)
    const logoUrl = supplier.logo_url || getSupplierLogoUrl(supplier.website_url)

    if (!logoUrl || failed) {
        return (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600">
                {getSupplierInitials(supplier.supplier)}
            </span>
        )
    }

    return (
        <Image
            src={logoUrl}
            alt=""
            width={36}
            height={36}
            unoptimized
            className="h-9 w-9 shrink-0 rounded border border-gray-200 bg-white object-contain"
            onLoad={(event) => { if (event.currentTarget.naturalWidth <= 16 && event.currentTarget.naturalHeight <= 16) setFailed(true) }}
            onError={() => setFailed(true)}
        />
    )
}

export function  formatEquipmentMatchReason(supplier) {
    const groups = Array.isArray(supplier?.match_reason?.groups) ? supplier.match_reason.groups : []
    if (groups.length === 0) return ''
    return groups.map((group) => `${group.label}: ${(group.values || []).join(', ')}`).join(' · ')
}

export function  TranscriptRowsDisplay({ transcript }) {
    const lines = String(transcript || '').split('\n').filter((line) => line.trim())

    if (lines.length === 0) {
        return <p className="text-sm text-gray-500">No transcript text available for this record.</p>
    }

    return (
        <div className="divide-y divide-gray-100 text-sm leading-6 text-gray-800">
            {lines.map((line, index) => {
                return <p key={`${index}-${line}`} className="py-2">{line}</p>
            })}
        </div>
    )
}

/**
 * Where an analyst support came from.
 *
 * The analyst records `sources` per support (see `two/src/lib/jobs/fcaAnalysisEvidence.js`); a
 * support is often stated by more than one place, so this is a set of badges rather than one label.
 * An item with no recorded provenance shows nothing - never a guessed source.
 */
export const  ANALYSIS_SUPPORT_SOURCE_BADGES = {
    notes: { label: 'Notes', className: 'bg-gray-100 text-gray-700' },
    transcript: { label: 'Transcript', className: 'bg-sky-100 text-sky-800' },
    document: { label: 'Document', className: 'bg-violet-100 text-violet-800' },
}

export function  AnalysisSupportSourceBadges({ sources, sourceNames }) {
    const kinds = (Array.isArray(sources) ? sources : [])
        .map((source) => String(source || '').trim().toLowerCase())
        .filter((source) => ANALYSIS_SUPPORT_SOURCE_BADGES[source])
    if (kinds.length === 0) return null

    const names = (Array.isArray(sourceNames) ? sourceNames : [])
        .map((name) => String(name || '').trim())
        .filter(Boolean)

    return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-gray-500">Came from</span>
            {kinds.map((kind) => {
                const badge = ANALYSIS_SUPPORT_SOURCE_BADGES[kind]
                return (
                    <span
                        key={kind}
                        // The file name stays off the chip (a long name would dominate the card) but
                        // is one hover away, the same way other file names in the app behave.
                        title={kind === 'document' && names.length > 0 ? `Reference document(s): ${names.join(', ')}` : undefined}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
                    >
                        {badge.label}
                    </span>
                )
            })}
        </div>
    )
}

/**
 * Which of the patient's files the FCA Analyst reads as evidence.
 *
 * The selection is a flag on the file row, not a setting in patient metadata, so a deleted file
 * cannot leave a stale selection behind and any consumer can query scope. This panel is a view
 * onto that flag.
 */
export function  AnalysisEvidenceDocumentsPanel({ files, loading, busyId, error, onToggle }) {
    const rows = Array.isArray(files) ? files : []
    const inScope = rows.filter((file) => file?.analysis_evidence === true).length

    return (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-medium text-gray-700">Reference documents in scope</p>
                    <p className="mt-1 text-[11px] text-gray-500">
                        Documents the analyst reads as evidence: letters of support, discharge summaries,
                        completed assessments. The analyst extracts only the facts a document records -
                        measures, observations, aids - and never treats a letter&apos;s conclusions or
                        funding request as findings about the participant.
                    </p>
                </div>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    {inScope} in scope
                </span>
            </div>

            {error ? <p className="mt-2 text-[11px] text-red-600">{error}</p> : null}

            {loading ? (
                <p className="mt-3 text-xs text-gray-500">Loading files...</p>
            ) : rows.length === 0 ? (
                <p className="mt-3 text-xs text-gray-500">
                    No files uploaded for this patient yet. Upload one on the Files tab, then put it in scope here.
                </p>
            ) : (
                <ul className="mt-3 space-y-1.5">
                    {rows.map((file) => {
                        const canReadText = classifyAttachmentTextSource(file.mime_type, file.file_name) !== 'binary'
                        const busy = String(busyId || '') === String(file.id)

                        return (
                            <li key={file.id} className="flex items-start gap-2 rounded border border-gray-200 bg-white px-2 py-1.5">
                                <input
                                    type="checkbox"
                                    checked={file.analysis_evidence === true}
                                    disabled={busy || !canReadText}
                                    onChange={(event) => onToggle(file, event.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs text-gray-800">{file.file_name}</span>
                                    <span className="block text-[11px] text-gray-500">
                                        {canReadText
                                            ? 'Text can be read'
                                            : 'Cannot be read as text - attach it at report time instead'}
                                    </span>
                                </span>
                                {busy ? <span className="shrink-0 text-[11px] text-gray-400">Saving...</span> : null}
                            </li>
                        )
                    })}
                </ul>
            )}

            <p className="mt-2 text-[11px] text-gray-500">
                Changing scope re-runs the analyst, so the analysis never lags behind the documents.
            </p>
        </div>
    )
}

export function  PatientUploadedFilesPanel({
    files,
    loading,
    uploading,
    deletingId,
    error,
    onUpload,
    onPreview,
    onDownload,
    onDelete,
}) {
    const uploadedFiles = Array.isArray(files) ? files : []
    const [preview, setPreview] = useState(null)
    const [openActionsFileId, setOpenActionsFileId] = useState('')
    const previewRequestRef = useRef(0)

    useEffect(() => {
        return () => {
            if (preview?.url) URL.revokeObjectURL(preview.url)
        }
    }, [preview?.url])

    useEffect(() => {
        if (!openActionsFileId) return undefined

        const closeActions = (event) => {
            if (event.type === 'keydown' && event.key !== 'Escape') return
            if (event.type === 'pointerdown' && event.target.closest('[data-patient-file-actions]')) return
            setOpenActionsFileId('')
        }

        document.addEventListener('pointerdown', closeActions)
        document.addEventListener('keydown', closeActions)
        return () => {
            document.removeEventListener('pointerdown', closeActions)
            document.removeEventListener('keydown', closeActions)
        }
    }, [openActionsFileId])

    const closePreview = () => {
        previewRequestRef.current += 1
        setPreview(null)
    }

    const openPreview = async (file) => {
        const kind = getPatientFilePreviewKind(file)
        if (!kind) return

        const requestId = previewRequestRef.current + 1
        previewRequestRef.current = requestId
        setPreview({ file, kind, loading: true, error: '', text: '', url: '', csvRows: [] })

        try {
            const blob = await onPreview(file)
            if (previewRequestRef.current !== requestId) return

            if (kind === 'json' || kind === 'csv' || kind === 'text') {
                const rawText = await blob.text()
                if (previewRequestRef.current !== requestId) return
                if (kind === 'json') {
                    try {
                        setPreview({ file, kind, loading: false, error: '', text: JSON.stringify(JSON.parse(rawText), null, 2), url: '', csvRows: [] })
                    } catch {
                        setPreview({ file, kind, loading: false, error: 'This file is not valid JSON. Showing its original contents.', text: rawText, url: '', csvRows: [] })
                    }
                    return
                }
                if (kind === 'csv') {
                    const parsed = Papa.parse(rawText, { skipEmptyLines: 'greedy' })
                    const csvRows = parsed.data
                        .filter((row) => Array.isArray(row))
                        .map((row) => row.map((cell) => String(cell ?? '')))
                    const parseError = parsed.errors?.[0]?.message || ''
                    setPreview({
                        file,
                        kind,
                        loading: false,
                        error: csvRows.length > 0 && parseError ? `CSV warning: ${parseError}` : (parseError || (csvRows.length === 0 ? 'No CSV rows could be parsed. Showing the original contents.' : '')),
                        text: rawText,
                        url: '',
                        csvRows,
                    })
                    return
                }
                setPreview({ file, kind, loading: false, error: '', text: rawText, url: '', csvRows: [] })
                return
            }

            const url = URL.createObjectURL(blob)
            if (previewRequestRef.current !== requestId) {
                URL.revokeObjectURL(url)
                return
            }
            setPreview({ file, kind, loading: false, error: '', text: '', url, csvRows: [] })
        } catch (previewError) {
            if (previewRequestRef.current !== requestId) return
            setPreview({ file, kind, loading: false, error: previewError?.message || 'Failed to preview file', text: '', url: '', csvRows: [] })
        }
    }

    return (
        <div className="rounded-md border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Uploaded Files</h3>
                    <p className="mt-1 text-xs text-gray-500">Files are stored with this patient record.</p>
                </div>
                <label className="cursor-pointer rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700">
                    {uploading ? 'Uploading...' : 'Upload File'}
                    <input
                        type="file"
                        className="sr-only"
                        disabled={uploading}
                        onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (file) onUpload(file)
                            event.target.value = ''
                        }}
                    />
                </label>
            </div>
            {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
            <div className="mt-3 rounded-md border border-gray-200">
                <table className="w-full table-fixed divide-y divide-gray-200 text-sm">
                    <colgroup>
                        <col />
                        <col className="w-20" />
                        <col className="w-12" />
                    </colgroup>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {uploadedFiles.map((file) => (
                            <tr key={file.id}>
                                <td className="min-w-0 px-3 py-2 text-gray-800">
                                    {getPatientFilePreviewKind(file) ? (
                                        <button
                                            type="button"
                                            onClick={() => openPreview(file)}
                                            title={file.file_name}
                                            className="block max-w-full truncate text-left font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                                        >
                                            {file.file_name}
                                        </button>
                                    ) : <span title={file.file_name} className="block truncate">{file.file_name}</span>}
                                </td>
                                <td className="px-3 py-2 text-xs text-gray-500">{formatApproximateFileSize(file.file_size)}</td>
                                <td className="relative px-2 py-2 text-right" data-patient-file-actions>
                                    <button
                                        type="button"
                                        onClick={() => setOpenActionsFileId((currentId) => currentId === String(file.id) ? '' : String(file.id))}
                                        aria-label={`Actions for ${file.file_name}`}
                                        aria-haspopup="menu"
                                        aria-expanded={openActionsFileId === String(file.id)}
                                        title="File actions"
                                        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                                    >
                                        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                                            <circle cx="10" cy="4" r="1.5" />
                                            <circle cx="10" cy="10" r="1.5" />
                                            <circle cx="10" cy="16" r="1.5" />
                                        </svg>
                                    </button>
                                    {openActionsFileId === String(file.id) && (
                                        <div className="absolute right-2 top-9 z-20 w-32 rounded-md border border-gray-200 bg-white py-1 text-left shadow-lg" role="menu">
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => {
                                                    setOpenActionsFileId('')
                                                    onDownload(file)
                                                }}
                                                className="block w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                Download
                                            </button>
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => {
                                                    setOpenActionsFileId('')
                                                    onDelete(file)
                                                }}
                                                disabled={deletingId === file.id}
                                                className="block w-full px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                                            >
                                                {deletingId === file.id ? 'Deleting...' : 'Delete'}
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {!loading && uploadedFiles.length === 0 && (
                            <tr><td colSpan={3} className="px-3 py-3 text-center text-xs text-gray-500">No uploaded files yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {preview && (
                <div
                    className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-900/60 p-3 md:p-6"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Preview ${preview.file?.file_name || 'file'}`}
                    onClick={closePreview}
                >
                    <div
                        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-4 py-3">
                            <h3 className="truncate text-sm font-semibold text-gray-900">{preview.file?.file_name}</h3>
                            <button
                                type="button"
                                onClick={closePreview}
                                aria-label="Close file preview"
                                title="Close"
                                className="rounded-md border border-gray-300 p-1.5 text-gray-700 hover:bg-gray-50"
                            >
                                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
                                    <path
                                        d="M5 5l10 10M15 5L5 15"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-4">
                            {preview.loading && <p className="py-12 text-center text-sm text-gray-500">Loading preview...</p>}
                            {preview.error && (
                                <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{preview.error}</p>
                            )}
                            {!preview.loading && preview.kind === 'pdf' && preview.url && (
                                <iframe src={preview.url} title={preview.file?.file_name || 'PDF preview'} className="h-[75vh] w-full rounded-md border border-gray-200 bg-white" />
                            )}
                            {!preview.loading && preview.kind === 'image' && preview.url && (
                                <div className="relative mx-auto h-[75vh] w-full">
                                    <Image
                                        src={preview.url}
                                        alt={preview.file?.file_name || 'Image preview'}
                                        fill
                                        unoptimized
                                        sizes="100vw"
                                        className="rounded-md object-contain"
                                    />
                                </div>
                            )}
                            {!preview.loading && preview.kind === 'audio' && preview.url && (
                                <audio src={preview.url} controls className="mx-auto my-12 w-full max-w-2xl" />
                            )}
                            {!preview.loading && preview.kind === 'video' && preview.url && (
                                <video src={preview.url} controls className="mx-auto max-h-[75vh] max-w-full rounded-md bg-black" />
                            )}
                            {!preview.loading && preview.kind === 'csv' && preview.csvRows?.length > 0 && (
                                <div>
                                    <div className="overflow-auto rounded-md border border-gray-200 bg-white">
                                        <table className="min-w-full border-separate border-spacing-0 text-left text-xs text-gray-800">
                                            <thead className="sticky top-0 z-10 bg-gray-100">
                                                <tr>
                                                    {preview.csvRows[0].map((heading, columnIndex) => (
                                                        <th key={columnIndex} scope="col" className="whitespace-nowrap border-b border-r border-gray-200 px-3 py-2 font-semibold last:border-r-0">
                                                            {heading || `Column ${columnIndex + 1}`}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {preview.csvRows.slice(1, CSV_PREVIEW_ROW_LIMIT + 1).map((row, rowIndex) => (
                                                    <tr key={rowIndex} className="odd:bg-white even:bg-gray-50">
                                                        {preview.csvRows[0].map((_, columnIndex) => (
                                                            <td key={columnIndex} className="max-w-sm whitespace-pre-wrap break-words border-b border-r border-gray-100 px-3 py-2 align-top last:border-r-0">
                                                                {row[columnIndex] || ''}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {preview.csvRows.length - 1 > CSV_PREVIEW_ROW_LIMIT && (
                                        <p className="mt-2 text-xs text-gray-500">Showing the first {CSV_PREVIEW_ROW_LIMIT.toLocaleString()} of {(preview.csvRows.length - 1).toLocaleString()} rows.</p>
                                    )}
                                </div>
                            )}
                            {!preview.loading && preview.kind === 'csv' && preview.csvRows?.length === 0 && (
                                <pre className="min-h-48 whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-white p-4 text-xs leading-5 text-gray-800">{preview.text}</pre>
                            )}
                            {!preview.loading && (preview.kind === 'json' || preview.kind === 'text') && (
                                <pre className="min-h-48 whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-white p-4 text-xs leading-5 text-gray-800">{preview.text}</pre>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

/**
 * One button in the patient tab strip. The strip holds as many as fifteen tabs
 * and scrolls sideways, so the buttons never shrink (that is what lets the
 * scroller measure an overflow) and the selected one is tagged so the strip can
 * pull it back into view when a tab is set programmatically. `workerContent` adds
 * the assistant mark, which is what marks a tab the workers write: every tab
 * shares one strip, so they all share the one selected state.
 */
export function  PatientTabButton({ tabKey, active, onSelect, title, domainKey = '', workerContent = false, children }) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-patient-tab={tabKey}
            title={workerContent ? [title, 'Contains worker-created content'].filter(Boolean).join(' · ') : title}
            onClick={() => onSelect(tabKey)}
            className={`flex-none rounded px-3 py-1.5 font-medium ${active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
        >
            <span className="inline-flex items-center gap-1.5">
                {children}
                {workerContent && (
                    <>
                        <AssistantAvatar
                            domainKey={domainKey}
                            iconClassName="h-4 w-4"
                            imageClassName="h-4 w-4"
                        />
                        <span className="sr-only">Contains worker-created content</span>
                    </>
                )}
            </span>
        </button>
    )
}
