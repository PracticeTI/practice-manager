// Downsizes a domain's master worker artwork into the small PNG the worker marks are
// served from.
//
// Why this exists: `public/<domain>/worker.png` is what `getDomainWorkerIconUrl()` hands
// the AI/worker surfaces (the assistant pods, the patient-modal tab mark), and those
// render it at 16-32 CSS px. The masters arrive as 1254px artwork, so the served file
// has to be a downscale. Running the downscale by hand buries the recipe and, worse,
// overwrites the only copy of the master — so this backs the master up first.
//
// Usage:
//   node scripts/build-worker-icon.mjs mybrand                    # dry run
//   node scripts/build-worker-icon.mjs mybrand --apply            # write the icon
//   node scripts/build-worker-icon.mjs default --size=64 --apply
//   node scripts/build-worker-icon.mjs mybrand --master=/tmp/art.png --apply
//
// Options:
//   --apply             write the icon (default is a dry run)
//   --size=<n>          icon edge in px (default 64)
//   --master=<path>     source artwork (default: the served icon path itself)
//   --force-backup      overwrite an existing worker-master.png backup
//
// Notes:
//   - The master is copied to `public/<domain>/worker-master.png` before the served file
//     is overwritten, and never deleted. Sizes are compared optically, not by file size:
//     a master whose content box is already icon-scale is left alone.
//   - `png({ palette: true, quality: 92 })` is the measured sweet spot for this art
//     (a 64px icon lands around 2KB). It is checked after the fact: the script re-reads
//     the written file and reports the composited error against an ideal truecolour
//     downscale, so quantisation damage shows up here instead of in the UI.
//   - `sharp` is used for image work but is not a declared dependency of this package;
//     it arrives via Next.js's optional dependency. The script says so plainly if it is
//     missing rather than failing with a bare import error.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SIZE = 64
const MAX_COMPOSITED_ERROR = 1 // out of 255

function parseArgs(argv) {
    const options = { domain: null, apply: false, size: DEFAULT_SIZE, master: null, forceBackup: false }
    for (const arg of argv) {
        if (arg === '--apply') options.apply = true
        else if (arg === '--force-backup') options.forceBackup = true
        else if (arg.startsWith('--size=')) options.size = Number.parseInt(arg.slice('--size='.length), 10)
        else if (arg.startsWith('--master=')) options.master = arg.slice('--master='.length)
        else if (!arg.startsWith('--')) options.domain = arg
    }
    return options
}

function usage(message) {
    if (message) console.error(`${message}\n`)
    console.error('Usage: node scripts/build-worker-icon.mjs <domain> [--size=64] [--master=<path>] [--apply]')
    process.exit(1)
}

async function loadSharp() {
    try {
        const imported = await import('sharp')
        return imported.default
    } catch {
        console.error('This script needs `sharp` for image work, but it could not be imported.')
        console.error('It normally arrives as an optional dependency of Next.js — run `npm install` first.')
        process.exit(1)
    }
}

const rel = (target) => path.relative(ROOT, target)

/** Content box of the visible pixels, so "is this already an icon?" ignores padding. */
async function contentBox(sharp, file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width, height, channels } = info
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * channels + 3] > 8) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
    }

    return { width, height, boxWidth: maxX - minX + 1, boxHeight: maxY - minY + 1 }
}

const downscale = (sharp, file, size) => sharp(file).resize(size, size, { fit: 'contain' })

const encodeIcon = (pipeline) => pipeline.png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })

/** Mean per-channel error after compositing both images onto white — what the eye sees. */
async function compositedError(leftPixels, rightPixels) {
    const [left, right] = [leftPixels.data, rightPixels.data]

    let total = 0
    let count = 0
    for (let i = 0; i < left.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            const alphaLeft = left[i + 3] / 255
            const alphaRight = right[i + 3] / 255
            total += Math.abs(left[i + c] * alphaLeft - right[i + c] * alphaRight + 255 * (alphaRight - alphaLeft))
            count += 1
        }
    }

    return total / count
}

async function main() {
    const options = parseArgs(process.argv.slice(2))
    if (!options.domain) usage('A domain key is required.')
    if (!Number.isInteger(options.size) || options.size < 8) usage('--size must be an integer of at least 8.')

    const sharp = await loadSharp()
    const domain = options.domain
    const iconPath = path.join(ROOT, 'public', domain, 'worker.png')
    const masterPath = options.master ? path.resolve(options.master) : iconPath
    const backupPath = path.join(ROOT, 'public', domain, 'worker-master.png')

    if (!fs.existsSync(masterPath)) usage(`No master artwork at ${rel(masterPath)}.`)

    const masterBuffer = fs.readFileSync(masterPath)
    const master = await contentBox(sharp, masterBuffer)
    const masterBytes = masterBuffer.length
    const boxEdge = Math.max(master.boxWidth, master.boxHeight)
    const isIconScale = boxEdge <= options.size * 2

    console.log(`master   ${rel(masterPath)}  ${master.width}x${master.height}  ${masterBytes} B`)
    console.log(`content  ${master.boxWidth}x${master.boxHeight} (visible pixels)`)
    console.log(`icon     ${rel(iconPath)}  ${options.size}x${options.size}`)

    if (isIconScale && masterPath === iconPath) {
        console.log(`\nAlready icon-scale (content box ${boxEdge}px <= ${options.size * 2}px) — nothing to do.`)
        return
    }

    const buffer = await encodeIcon(downscale(sharp, masterBuffer, options.size)).toBuffer()

    if (masterPath === iconPath) {
        if (fs.existsSync(backupPath) && !options.forceBackup) {
            console.log(`\nbackup   ${rel(backupPath)} already exists — keeping it (pass --force-backup to replace).`)
        } else {
            console.log(`\nbackup   ${rel(backupPath)}  ${masterBytes} B`)
            if (options.apply) fs.copyFileSync(masterPath, backupPath)
        }
    }

    const reduction = (1 - buffer.length / masterBytes) * 100
    console.log(`result   ${buffer.length} B  (${reduction.toFixed(1)}% smaller)`)

    if (!options.apply) {
        console.log('\nDry run — nothing written. Re-run with --apply.')
        return
    }

    fs.writeFileSync(iconPath, buffer)

    // Verify what actually landed on disk, not what we intended to write.
    const written = await contentBox(sharp, iconPath)
    const [writtenPixels, idealPixels] = await Promise.all([
        sharp(iconPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
        downscale(sharp, masterBuffer, options.size).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ])
    const error = await compositedError(writtenPixels, idealPixels)

    console.log(`\nwrote    ${rel(iconPath)}  ${written.boxWidth}x${written.boxHeight} content in ${written.width}x${written.height}`)
    console.log(`quality  mean composited error ${error.toFixed(3)}/255 (limit ${MAX_COMPOSITED_ERROR})`)

    if (error > MAX_COMPOSITED_ERROR) {
        console.error('Quantisation is visible — try dropping `palette: true` in encodeIcon().')
        process.exit(1)
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
