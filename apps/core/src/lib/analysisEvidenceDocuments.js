// Reference documents in scope for the FCA Analyst.
//
// A patient's file store already holds letters, reports and assessments. Some of them are not
// "attachments for the report" but evidence about the participant's function - a treating
// therapist's Letter of Support, a hospital discharge summary, a standardised assessment. The
// analyst is the right place to read them: it turns them into the same domain-tagged findings the
// rest of the FCA pipeline consumes, instead of 60,000 characters of raw prose competing for
// sentence slots at report time.
//
// Scope is a flag on the file row (`patient_files.analysis_evidence`), not a list in patient
// metadata: the document and its scope live together, and deleting the file removes it from scope.
//
// Extraction happens here, in the `one` app, because the worker service (`two`) has no DOCX or
// PDF reader. The extracted text travels with the analyst job payload, exactly as
// `additionalContext` travels with a report job.

import { getDatabaseConnection } from './database.js'
import { withPostgresRlsContext } from './postgresRlsContext.js'
import { ensurePatientFilesTable } from './patientFilesTable.js'
import { extractAttachmentText, ATTACHMENT_TEXT_OK } from './attachmentText.js'
import { readStoredFileBuffer } from './fileStore.js'
import { MAX_ANALYSIS_DOCUMENT_TEXT_CHARS, normalizeAnalysisDocuments } from './analysisEvidenceDocumentScope.js'

/**
 * The file ids currently in the analyst's evidence scope, without extracting anything.
 *
 * The report job carries these so the worker can tell whether the stored analysis was built from the
 * same documents it is about to write from. Deliberately does not run the table migration: a queue
 * request should not pay for DDL, and this answer is "no documents" either way.
 */
export async function loadAnalysisEvidenceDocumentIds({ domain, patientId } = {}) {
    const normalizedDomain = String(domain || '').trim().toLowerCase()
    const numericPatientId = Number.parseInt(String(patientId ?? ''), 10)
    if (!normalizedDomain || !Number.isFinite(numericPatientId) || numericPatientId <= 0) return []

    let connection = null
    try {
        connection = await getDatabaseConnection()
        const result = await withPostgresRlsContext(
            connection,
            { domain: normalizedDomain, role: 'admin' },
            (scopedConnection) => scopedConnection.query(
                `SELECT id FROM patient_files
                 WHERE domain = $1 AND patient_id = $2 AND analysis_evidence IS TRUE
                 ORDER BY id ASC`,
                [normalizedDomain, numericPatientId]
            )
        )

        return (result?.rows || [])
            .map((row) => Number.parseInt(String(row.id ?? ''), 10))
            .filter((id) => Number.isFinite(id) && id > 0)
    } catch (error) {
        console.warn('[analysis-evidence] could not load document scope ids:', error?.message || error)
        return []
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

/**
 * Read the flagged files for a patient and extract their text.
 *
 * Never throws: a missing file table, an unreadable DOCX or PDF, or a domain without files must not
 * stop an analysis run. A document that fails to read is simply not evidence.
 */
export async function loadAnalysisEvidenceDocuments({ domain, patientId } = {}) {
    const normalizedDomain = String(domain || '').trim().toLowerCase()
    const numericPatientId = Number.parseInt(String(patientId ?? ''), 10)
    if (!normalizedDomain || !Number.isFinite(numericPatientId) || numericPatientId <= 0) return []

    let connection = null
    try {
        await ensurePatientFilesTable()
        connection = await getDatabaseConnection()
        const result = await withPostgresRlsContext(
            connection,
            { domain: normalizedDomain, role: 'admin' },
            (scopedConnection) => scopedConnection.query(
                `SELECT id, file_name, mime_type, file_data, storage_backend, storage_key
                 FROM patient_files
                 WHERE domain = $1 AND patient_id = $2 AND analysis_evidence IS TRUE
                 ORDER BY created_at ASC NULLS LAST, id ASC`,
                [normalizedDomain, numericPatientId]
            )
        )

        const documents = []
        for (const row of result?.rows || []) {
            // The evidence document may live in the practice's bucket or local store
            // rather than the row, so read it the same way a download would.
            const buffer = await readStoredFileBuffer({
                storageBackend: row.storage_backend,
                storageKey: row.storage_key,
                fileData: row.file_data,
            })
            const extraction = await extractAttachmentText({
                mimeType: row.mime_type,
                fileName: row.file_name,
                buffer,
                maxChars: MAX_ANALYSIS_DOCUMENT_TEXT_CHARS,
            })
            if (extraction.status !== ATTACHMENT_TEXT_OK || !extraction.text) continue

            documents.push({
                id: row.id,
                fileName: row.file_name,
                text: extraction.text,
                truncated: extraction.truncated,
                originalLength: extraction.originalLength,
            })
        }

        return normalizeAnalysisDocuments(documents)
    } catch (error) {
        console.warn('[analysis-evidence] could not load reference documents:', error?.message || error)
        return []
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
