export function  getAudioExtensionFromMimeType(mimeType) {
    const normalized = String(mimeType || '').trim().toLowerCase()
    if (!normalized) return 'webm'
    if (normalized.includes('webm')) return 'webm'
    if (normalized.includes('mp4')) return 'm4a'
    if (normalized.includes('mpeg')) return 'mp3'
    if (normalized.includes('mp3')) return 'mp3'
    if (normalized.includes('wav')) return 'wav'
    if (normalized.includes('ogg')) return 'ogg'
    return 'webm'
}

export function  formatMicrophonePermissionLabel(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'granted') return 'Granted'
    if (normalized === 'denied') return 'Denied'
    if (normalized === 'prompt') return 'Prompt'
    return 'Unknown'
}

export function  toDisplayNameFromIdentifier(value, fallbackLabel) {
    const raw = String(value || '').trim()
    if (!raw) return fallbackLabel

    const lower = raw.toLowerCase()
    if (lower === 'localhost-dev' || lower === 'vercel-preview') {
        return fallbackLabel
    }

    const cleaned = raw
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    if (!cleaned) return fallbackLabel

    return cleaned
        .split(' ')
        .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}` : '')
        .join(' ')
}

export function  splitTranscriptIntoUtterances(rawText) {
    const text = String(rawText || '').replace(/\r/g, '').trim()
    if (!text) return []

    const sourceLines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    const sentenceParts = sourceLines.length > 1
        ? sourceLines
        : text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean)

    return sentenceParts.flatMap((sentence) => {
        const words = sentence.split(/\s+/).filter(Boolean)
        if (words.length <= 32) return [sentence]

        const chunks = []
        for (let index = 0; index < words.length; index += 32) {
            chunks.push(words.slice(index, index + 32).join(' '))
        }
        return chunks
    })
}

export function  mergeFloat32Chunks(chunks) {
    const list = Array.isArray(chunks) ? chunks : []
    const totalLength = list.reduce((sum, chunk) => sum + (chunk?.length || 0), 0)
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of list) {
        if (!(chunk instanceof Float32Array)) continue
        merged.set(chunk, offset)
        offset += chunk.length
    }
    return merged
}

export function  encodeWavFromFloat32(samples, sampleRate) {
    const pcmData = samples instanceof Float32Array ? samples : new Float32Array(0)
    const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100
    const bytesPerSample = 2
    const blockAlign = bytesPerSample
    const byteRate = safeSampleRate * blockAlign
    const dataSize = pcmData.length * bytesPerSample
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    const writeString = (offset, value) => {
        for (let i = 0; i < value.length; i += 1) {
            view.setUint8(offset + i, value.charCodeAt(i))
        }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, safeSampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, 16, true)
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)

    let offset = 44
    for (let i = 0; i < pcmData.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, pcmData[i]))
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff
        view.setInt16(offset, intSample, true)
        offset += 2
    }

    return new Blob([buffer], { type: 'audio/wav' })
}

export async function  maybeConvertAudioBlobToWav(blob) {
    if (!(blob instanceof Blob)) return blob

    const originalMime = String(blob.type || '').trim().toLowerCase()
    if (originalMime.includes('wav')) return blob
    if (typeof window === 'undefined') return blob

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor) return blob

    let context = null
    try {
        context = new AudioContextCtor()
        const arrayBuffer = await blob.arrayBuffer()
        const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0))
        const channelCount = Math.max(1, Number(audioBuffer.numberOfChannels || 1))
        const frameCount = Number(audioBuffer.length || 0)
        if (!Number.isFinite(frameCount) || frameCount <= 0) {
            return blob
        }

        const mono = new Float32Array(frameCount)
        for (let channel = 0; channel < channelCount; channel += 1) {
            const samples = audioBuffer.getChannelData(channel)
            for (let i = 0; i < frameCount; i += 1) {
                mono[i] += samples[i] / channelCount
            }
        }

        return encodeWavFromFloat32(mono, audioBuffer.sampleRate)
    } catch {
        return blob
    } finally {
        try { await context?.close?.() } catch { }
    }
}

export function  getPatientFilePreviewKind(file) {
    const mimeType = String(file?.mime_type || '').trim().toLowerCase()
    const fileName = String(file?.file_name || '').trim().toLowerCase()
    const extension = fileName.includes('.') ? fileName.split('.').pop() : ''

    if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
    if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(extension)) return 'image'
    if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(extension)) return 'audio'
    if (mimeType.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(extension)) return 'video'
    if (mimeType === 'application/json' || extension === 'json') return 'json'
    if (mimeType === 'text/csv' || extension === 'csv') return 'csv'
    if (
        mimeType.startsWith('text/')
        || ['txt', 'md', 'markdown', 'tsv', 'xml', 'log', 'yaml', 'yml'].includes(extension)
        || ['application/xml', 'application/yaml', 'application/x-yaml'].includes(mimeType)
    ) return 'text'

    return null
}
