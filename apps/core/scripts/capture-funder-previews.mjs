#!/usr/bin/env node
/**
 * Capture phone-width screenshots of funder documentation — both web pages and PDFs.
 *
 * This is the funder-side sibling of `src/lib/providerHeroScreenshot.js`: same idea (drive the
 * locally installed Chrome over the DevTools Protocol, emulate a phone with
 * `Emulation.setDeviceMetricsOverride { mobile: true }`, capture the viewport), but written as a
 * standalone CLI so a capture can be tried before anything is wired into the app.
 *
 * It is deliberately self-contained: plain `node`, no npm dependency, no `@/lib/...` alias (Node
 * ESM cannot resolve those without the Next bundler), so it runs as
 * `node scripts/capture-funder-previews.mjs`.
 *
 * Default targets are the two shapes a funder card would have to render:
 *   - a web page (`doc_type: 'link'`)
 *   - a PDF (`doc_type: 'file'`)
 * both at iPhone SE size.
 *
 * Usage:
 *   node scripts/capture-funder-previews.mjs
 *   node scripts/capture-funder-previews.mjs --url <url> --name <slug> --url ... --name ...
 *   node scripts/capture-funder-previews.mjs --headed --settle 4000
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/* --- Viewports ----------------------------------------------------------- */

/**
 * iPhone SE (2nd/3rd generation) — 375x667 CSS px at DPR 2, so the PNG lands at 750x1334.
 * The 1st-generation SE was 320x568, which is below what any current site targets.
 */
export const IPHONE_SE_VIEWPORT = { width: 375, height: 667, deviceScaleFactor: 2 }

/* --- Default targets ----------------------------------------------------- */

const NDIS_WEB_PAGE = {
    name: 'ndis-web-pricing-arrangements',
    url: 'https://www.ndis.gov.au/providers/pricing-and-payments/pricing/pricing-arrangements',
    kind: 'web',
}

const NDIS_PDF = {
    name: 'ndis-pdf-pricing-schedule-2026-27',
    url: 'https://www.ndis.gov.au/media/8841/download?attachment',
    kind: 'pdf',
}

/**
 * Chrome's PDF viewer is the DESKTOP one even under phone emulation: at 375px it squeezes in a
 * thumbnail sidebar and its toolbar, so a third of the frame is viewer chrome rather than document.
 *
 * It does honour Acrobat-style open parameters, so the fragment below turns the sidebar off
 * (`pagemode=none`), hides the toolbar, and fits page 1 to the width. Override per target with
 * `--fragment`, or empty it with `--fragment ''` to capture the untouched viewer.
 */
const PDF_VIEW_FRAGMENT = '#page=1&zoom=page-width&pagemode=none&toolbar=0'

const DEFAULT_TARGETS = [NDIS_WEB_PAGE, NDIS_PDF]

/* --- Chrome plumbing ----------------------------------------------------- */

const COMMAND_TIMEOUT_MS = 30000
const LOAD_EVENT_WAIT_MS = 20000
const DEFAULT_SETTLE_MS = 1500

const CHROME_CANDIDATES = {
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
}

const CHROME_FLAGS = [
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-dev-shm-usage',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--deny-permission-prompts',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--mute-audio',
    // NOT passed: --disable-extensions. Chrome's PDF viewer is a component extension, and the
    // whole point of this script is to find out whether a PDF renders in a headless capture.
]

export function resolveChromePath() {
    const configured = String(process.env.CHROME_PATH || '').trim()
    if (configured && existsSync(configured)) return configured
    const found = (CHROME_CANDIDATES[process.platform] || []).find((candidate) => existsSync(candidate))
    if (found) return found
    throw new Error('No Chrome or Chromium binary found. Set CHROME_PATH.')
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function openSocket(socketUrl) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(socketUrl)
        const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools')), COMMAND_TIMEOUT_MS)
        socket.addEventListener('open', () => {
            clearTimeout(timer)
            resolve(socket)
        })
        socket.addEventListener('error', () => {
            clearTimeout(timer)
            reject(new Error('Unable to connect to Chrome DevTools'))
        })
    })
}

/** Minimal DevTools Protocol client: command ids plus single-shot event waits. */
function createCdpClient(socket) {
    let nextId = 0
    const pending = new Map()
    const eventQueues = new Map()

    const failPending = (reason) => {
        for (const { reject } of pending.values()) reject(reason)
        pending.clear()
        for (const queue of eventQueues.values()) queue.length = 0
    }
    socket.addEventListener('close', () => failPending(new Error('Chrome DevTools connection closed')))

    socket.addEventListener('message', (event) => {
        let message
        try {
            message = JSON.parse(event.data)
        } catch {
            return
        }

        if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id)
            pending.delete(message.id)
            if (message.error) {
                const detail = message.error.data ? ` (${JSON.stringify(message.error.data)})` : ''
                reject(new Error(`${message.error.message || 'Chrome DevTools command failed'}${detail}`))
            } else {
                resolve(message.result)
            }
            return
        }

        if (!message.method) return
        const key = `${message.sessionId || ''}:${message.method}`
        const queue = eventQueues.get(key)
        if (queue && queue.length > 0) queue.shift()(message.params)
    })

    return {
        send(method, params = {}, sessionId) {
            const id = ++nextId
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(id)
                    reject(new Error(`Chrome DevTools command timed out: ${method}`))
                }, COMMAND_TIMEOUT_MS)

                pending.set(id, {
                    resolve: (value) => {
                        clearTimeout(timer)
                        resolve(value)
                    },
                    reject: (error) => {
                        clearTimeout(timer)
                        reject(error)
                    },
                })

                socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
            })
        },
        once(method, sessionId, timeoutMs) {
            return new Promise((resolve, reject) => {
                const key = `${sessionId || ''}:${method}`
                const queue = eventQueues.get(key) || []
                const handler = (params) => {
                    clearTimeout(timer)
                    resolve(params)
                }
                queue.push(handler)
                eventQueues.set(key, queue)

                const timer = setTimeout(() => {
                    eventQueues.set(key, (eventQueues.get(key) || []).filter((item) => item !== handler))
                    reject(new Error(`Timed out waiting for ${method}`))
                }, timeoutMs)
            })
        },
        close() {
            try {
                socket.close()
            } catch {
                // Socket already gone.
            }
        },
    }
}

async function readDevToolsPort(portFile) {
    const started = Date.now()
    while (Date.now() - started < COMMAND_TIMEOUT_MS) {
        try {
            const contents = await readFile(portFile, 'utf8')
            const [port] = contents.split('\n')
            if (port && Number(port) > 0) return Number(port)
        } catch {
            // Chrome has not written the file yet.
        }
        await delay(120)
    }
    throw new Error('Chrome did not report a DevTools port')
}

async function launchBrowser({ headless = true, profileDir }) {
    const chromePath = resolveChromePath()
    await mkdir(profileDir, { recursive: true })

    const portFile = path.join(profileDir, 'DevToolsActivePort')
    // A persistent profile survives between runs, so a stale port file would be read as current.
    await rm(portFile, { force: true })

    const modeFlags = headless ? ['--headless=new'] : ['--window-size=520,980']
    const child = spawn(
        chromePath,
        [...CHROME_FLAGS, ...modeFlags, '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank'],
        { stdio: 'ignore' },
    )

    const shutdown = async () => {
        if (child.exitCode !== null || child.signalCode !== null) return
        const exited = new Promise((resolve) => child.once('exit', resolve))
        try {
            child.kill('SIGKILL')
        } catch {
            // Already exited.
        }
        await Promise.race([exited, delay(4000)])
    }

    try {
        const port = await readDevToolsPort(portFile)
        const response = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (!response.ok) throw new Error('Chrome DevTools endpoint is unavailable')
        const { webSocketDebuggerUrl } = await response.json()
        const socket = await openSocket(webSocketDebuggerUrl)
        return { client: createCdpClient(socket), child, shutdown }
    } catch (error) {
        await shutdown()
        throw error
    }
}

/* --- Capture ------------------------------------------------------------- */

/**
 * Wait until a file lands in the download directory and stops growing.
 *
 * Polling rather than `Browser.downloadProgress` events because the interesting signal is "the
 * bytes are on disk and final", and a progress stream gives that as a sequence (inProgress ->
 * completed) we would have to filter anyway.
 */
async function waitForDownloadedFile(dir, { timeoutMs = 60000 } = {}) {
    const started = Date.now()
    let last = { name: '', size: -1 }

    while (Date.now() - started < timeoutMs) {
        const entries = existsSync(dir) ? await readdir(dir) : []
        const candidate = entries.find((entry) => !entry.startsWith('.') && entry !== 'interrupted')
        if (candidate) {
            const full = path.join(dir, candidate)
            const { size } = await stat(full).catch(() => ({ size: -1 }))
            // Two identical reads in a row means the writer has finished.
            if (candidate === last.name && size === last.size && size > 0) return full
            last = { name: candidate, size }
        }
        await delay(200)
    }

    throw new Error('Timed out waiting for the file download to finish')
}

/** Navigate to `url`, let Chrome save the response, then open the saved file and capture it. */
async function captureDownloadedDocument(client, target, { viewport, settleMs, downloadDir, fullPage, dumpFrames, cropFirstPage }) {
    await mkdir(downloadDir, { recursive: true })
    // `Browser.setDownloadBehavior` is a browser-level command: no session id.
    await client.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
        eventsEnabled: true,
    })

    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    try {
        const { sessionId: page } = await client.send('Target.attachToTarget', { targetId, flatten: true })
        await client.send('Page.enable', {}, page)
        await client.send('Page.navigate', { url: target.url }, page)
    } catch {
        // A download navigation can abort the pending load; the file is what matters.
    }

    const file = await waitForDownloadedFile(downloadDir)
    await client.send('Target.closeTarget', { targetId }).catch(() => { })
    const { size } = await stat(file)

    const capture = await captureTarget(
        client,
        { url: `file://${file}${target.fragment ?? PDF_VIEW_FRAGMENT}` },
        { viewport, settleMs, fullPage, dumpFrames, cropFirstPage },
    )
    return { ...capture, downloadedFile: file, downloadedBytes: size }
}

/**
 * Crop a PDF-viewer capture down to page 1, and report the rectangle that was used.
 *
 * Chrome draws the document on a flat letterbox background, and the viewer's own DOM is not
 * reachable over CDP (no MimeHandlerView guest frame appears in `Page.getFrameTree`), so the
 * geometry is read back out of the pixels instead of queried:
 *
 *   1. the colour at (0, 0) IS the letterbox colour — anything else is document or chrome;
 *   2. `top` is the first row containing a non-letterbox pixel, and `left`/`right` are the
 *      horizontal extent of non-letterbox pixels from there down;
 *   3. `bottom` is the first row after `top` whose centre pixel is letterbox-coloured again —
 *      the gap between page 1 and page 2.
 *
 * The crop is done here in the canvas that measured it rather than with
 * `Page.captureScreenshot { clip }`: under `mobile: true` emulation the clip rect's coordinate
 * space does not line up with the capture (a clip of the measured rect came back a magnified
 * fragment). Round-tripping the pixels is deterministic, and PNG re-encoding is lossless.
 *
 * Runs in the page that produced the capture, so no PNG decoder and no dependency are needed.
 */
async function cropToFirstPage(client, sessionId, png) {
    const expression = `(async () => {
        const image = new Image();
        image.src = 'data:image/png;base64,${png.toString('base64')}';
        await image.decode();

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);

        const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
        const isLetterbox = (x, y) => {
            const i = (y * width + x) * 4;
            return Math.abs(data[i] - data[0]) < 12
                && Math.abs(data[i + 1] - data[1]) < 12
                && Math.abs(data[i + 2] - data[2]) < 12;
        };

        let top = -1;
        for (let y = 0; y < height && top < 0; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (!isLetterbox(x, y)) { top = y; break; }
            }
        }
        if (top < 0) return JSON.stringify(null);

        let left = width;
        let right = -1;
        for (let y = top; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (!isLetterbox(x, y)) {
                    if (x < left) left = x;
                    if (x > right) right = x;
                }
            }
        }

        const centre = Math.floor((left + right) / 2);
        let bottom = height - 1;
        for (let y = top + 1; y < height; y += 1) {
            if (isLetterbox(centre, y)) { bottom = y - 1; break; }
        }

        const box = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
        const cropped = document.createElement('canvas');
        cropped.width = box.width;
        cropped.height = box.height;
        cropped.getContext('2d').drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

        return JSON.stringify({ box, frame: { width, height }, dataUrl: cropped.toDataURL('image/png') });
    })()`

    const { result } = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
    }, sessionId).catch(() => ({ result: null }))

    let measured
    try {
        measured = result?.value ? JSON.parse(result.value) : null
    } catch {
        measured = null
    }

    if (!measured?.dataUrl) return { png, box: null, frame: null }

    return {
        png: Buffer.from(measured.dataUrl.split(',')[1], 'base64'),
        box: measured.box,
        frame: measured.frame,
    }
}

/** What did we actually land on? A PDF leaves an empty `innerText` and a plugin embed. */
async function describeDocument(client, sessionId) {
    const { result } = await client.send('Runtime.evaluate', {
        expression: `JSON.stringify({
            status: (performance.getEntriesByType('navigation')[0] || {}).responseStatus || 0,
            url: location.href,
            title: document.title,
            contentType: document.contentType || '',
            embeds: document.querySelectorAll('embed, object').length,
            text: (document.body ? document.body.innerText : '').slice(0, 300)
        })`,
        returnByValue: true,
    }, sessionId).catch(() => ({ result: null }))

    try {
        return JSON.parse(result?.value || '{}')
    } catch {
        return {}
    }
}

async function captureTarget(client, target, { viewport, settleMs, fullPage, dumpFrames = false, cropFirstPage = false }) {
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    try {
        const { sessionId: page } = await client.send('Target.attachToTarget', { targetId, flatten: true })
        await client.send('Page.enable', {}, page)

        await client.send('Emulation.setDeviceMetricsOverride', {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: viewport.deviceScaleFactor,
            mobile: true,
        }, page)

        const loaded = client.once('Page.loadEventFired', page, LOAD_EVENT_WAIT_MS)
        await client.send('Page.navigate', { url: target.url }, page)
        await Promise.race([loaded, delay(LOAD_EVENT_WAIT_MS)]).catch(() => { })
        await delay(settleMs)

        const info = await describeDocument(client, page)

        if (dumpFrames) {
            const { frameTree } = await client.send('Page.getFrameTree', {}, page).catch(() => ({ frameTree: null }))
            const walk = (node, depth = 0) => {
                if (!node) return
                console.log(`${'  '.repeat(depth)}frame ${node.frame?.url} (${node.frame?.mimeType || '?'})`)
                for (const child of node.childFrames || []) walk(child, depth + 1)
            }
            walk(frameTree)
        }

        const { data } = await client.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: Boolean(fullPage),
        }, page)
        let png = Buffer.from(data, 'base64')
        let crop = null
        let frame = null

        if (cropFirstPage) {
            const result = await cropToFirstPage(client, page, png)
            png = result.png
            crop = result.box
            frame = result.frame
        }

        return { png, info, crop, frame }
    } finally {
        await client.send('Target.closeTarget', { targetId }).catch(() => { })
    }
}

/* --- CLI ----------------------------------------------------------------- */

function parseArgs(argv) {
    const options = {
        targets: [],
        outDir: path.join(process.cwd(), 'public', 'funders', 'previews'),
        viewport: { ...IPHONE_SE_VIEWPORT },
        settleMs: DEFAULT_SETTLE_MS,
        headless: true,
        fullPage: false,
        dumpFrames: false,
        pdfCrop: 'page1',
        downloadDir: path.join(tmpdir(), 'practice-funder-preview-downloads'),
    }

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        const next = () => argv[++index]
        if (arg === '--url') options.targets.push({ name: '', url: next(), kind: '' })
        else if (arg === '--name') options.targets[options.targets.length - 1].name = next()
        else if (arg === '--kind') options.targets[options.targets.length - 1].kind = next()
        else if (arg === '--out-dir') options.outDir = path.resolve(next())
        else if (arg === '--width') options.viewport.width = Number(next())
        else if (arg === '--height') options.viewport.height = Number(next())
        else if (arg === '--dpr') options.viewport.deviceScaleFactor = Number(next())
        else if (arg === '--settle') options.settleMs = Number(next())
        else if (arg === '--fragment') options.fragment = next()
        else if (arg === '--headed') options.headless = false
        else if (arg === '--full-page') options.fullPage = true
        else if (arg === '--dump-frames') options.dumpFrames = true
        else if (arg === '--pdf-crop') options.pdfCrop = next()
    }

    if (options.targets.length === 0) options.targets = DEFAULT_TARGETS.map((target) => ({ ...target }))

    options.targets = options.targets.map((target, index) => ({
        ...target,
        name: target.name || `capture-${index + 1}`,
        fragment: options.fragment !== undefined ? options.fragment : target.fragment,
    }))

    return options
}

function slugify(value) {
    return String(value || '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'capture'
}

async function main() {
    const options = parseArgs(process.argv.slice(2))
    await mkdir(options.outDir, { recursive: true })

    const profileDir = path.join(tmpdir(), 'practice-funder-preview-chrome')
    const browser = await launchBrowser({ headless: options.headless, profileDir })
    const results = []

    try {
        for (const target of options.targets) {
            const started = Date.now()
            try {
                const captureOptions = {
                    viewport: options.viewport,
                    settleMs: options.settleMs,
                    fullPage: options.fullPage,
                    dumpFrames: options.dumpFrames,
                    // Only a PDF has a viewer letterbox to trim; a web page's top-left pixel is page
                    // content, so the same measurement would garbage-crop it.
                    cropFirstPage: target.kind === 'pdf' && options.pdfCrop === 'page1',
                }

                // A `doc_type: 'file'` link answers with `Content-Disposition: attachment`, so Chrome
                // downloads it and the tab stays blank. Save it, then open the saved file, which the
                // PDF viewer does render.
                const { png, info, downloadedBytes, crop, frame } = target.kind === 'pdf'
                    ? await captureDownloadedDocument(browser.client, target, {
                        ...captureOptions,
                        downloadDir: path.join(options.downloadDir, slugify(target.name)),
                    })
                    : await captureTarget(browser.client, target, captureOptions)

                const file = path.join(options.outDir, `${slugify(target.name)}.png`)
                await writeFile(file, png)
                results.push({
                    name: target.name,
                    url: target.url,
                    kind: target.kind || '',
                    file,
                    bytes: png.length,
                    downloadedBytes,
                    crop,
                    frame,
                    ms: Date.now() - started,
                    info,
                })
                console.log(`ok   ${target.name.padEnd(38)} ${String(png.length).padStart(8)} bytes  ${Date.now() - started}ms  -> ${file}`)
            } catch (error) {
                results.push({ name: target.name, url: target.url, kind: target.kind || '', error: String(error?.message || error) })
                console.log(`FAIL ${target.name.padEnd(38)} ${error?.message || error}`)
            }
        }
    } finally {
        await browser.shutdown()
    }

    console.log('\n--- document probe ---')
    for (const result of results) {
        if (result.error) {
            console.log(`${result.name}: ERROR ${result.error}`)
            continue
        }
        const { status, contentType, embeds, title } = result.info || {}
        console.log(`${result.name}: status=${status} contentType=${contentType} embeds=${embeds} title=${JSON.stringify(title || '')}${result.downloadedBytes ? ` downloaded=${result.downloadedBytes}B` : ''}`)
        if (result.crop) {
            const { x, y, width, height } = result.crop
            const frame = result.frame ? ` of ${result.frame.width}x${result.frame.height}` : ''
            console.log(`${result.name}: page-1 crop ${width}x${height} at ${x},${y}${frame}`)
        }
    }

    const failures = results.filter((result) => result.error)
    if (failures.length > 0) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
}
