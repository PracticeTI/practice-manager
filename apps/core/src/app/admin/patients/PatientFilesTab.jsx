'use client'

import { PatientUploadedFilesPanel } from './PatientPageParts'
export default function PatientFilesTab({
    onDeletePatientFile,
    onDownloadPatientFile,
    onPreviewPatientFile,
    onUploadPatientFile,
    patientFileDeletingId,
    patientFileUploading,
    patientFiles,
    patientFilesError,
    patientFilesLoading,
}) {
    return (
        <PatientUploadedFilesPanel
            files={patientFiles}
            loading={patientFilesLoading}
            uploading={patientFileUploading}
            deletingId={patientFileDeletingId}
            error={patientFilesError}
            onUpload={onUploadPatientFile}
            onPreview={onPreviewPatientFile}
            onDownload={onDownloadPatientFile}
            onDelete={onDeletePatientFile}
        />
    )
}
