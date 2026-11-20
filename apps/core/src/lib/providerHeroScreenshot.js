// Mobile above-the-fold screenshots of provider websites.
//
// The directory already stores each practice's `website_url`. Rendering that site
// inside our own page is not an option (cross-origin framing is blocked by most
// practices, and we should not proxy a third party's HTML), and the commercial
// screenshot APIs only emulate a mobile device on their paid tiers — their free
// tier renders from a 1200x1200 desktop browser, which is why an earlier attempt
// produced squashed desktop crops rather than mobile captures.
//
// So we capture locally with the Chrome that is already installed: launch headless
// Chrome, drive it over the DevTools Protocol with `Emulation.setDeviceMetricsOverride`
// (mobile: true), and grab the viewport. No npm dependency is added — Node ships a
// global WebSocket, which is all the protocol needs.
//
// Captures are cached on disk (7 days) because a cold capture takes a few seconds
// and a provider's homepage does not change minute to minute.
//
// A human can also review a site before it is captured. Most practice sites open with a
// cookie banner, chat widget, or announcement popup (and those popups often use a bare
// "X" button that no text matcher can find), so `startCaptureSession` opens the same
// mobile viewport in a VISIBLE Chrome window, the reviewer dismisses what they want, and
// `commitCaptureSession` captures exactly the state they were looking at.
//
// The browser profile is persistent and shared. Cookies are domain-scoped, so a banner
// dismissed once during review stays dismissed for that site on every later automated
// capture — the review step improves the automatic results rather than just fixing one image.
//
// A few hosts branch on the user agent rather than on viewport width and serve a desktop layout at
// 390px (any Wix site does). Those can be opted in to a mobile user agent individually, via
// ua-overrides.json — see the note on MOBILE_USER_AGENT.

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    BANNER_HIDE_DOCUMENT_SCRIPT,
    BANNER_RULES_FINGERPRINT,
    buildBannerSweepExpression,
    isChromeHidingEnabled,
    siteHideRulesFor,
} from '@/lib/providerHeroBannerHiding'
import {
    PROVIDER_HERO_PUBLIC_PREFIX,
    PROVIDER_HERO_VIEWPORT,
    providerHeroHostname,
} from '@/lib/providerHeroPreview'

const VIEWPORT_WIDTH = PROVIDER_HERO_VIEWPORT.width
const VIEWPORT_HEIGHT = PROVIDER_HERO_VIEWPORT.height
const DEVICE_SCALE_FACTOR = 2
// Bump when the capture pipeline changes, so existing cached renders are not reused.
const CAPTURE_REVISION = 'r3'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const COMMAND_TIMEOUT_MS = 25000
const NAVIGATION_SETTLE_MS = 1200
const LOAD_EVENT_WAIT_MS = 15000
// Consent walls and announcement strips are often injected a beat after the load event, so the
// banner sweep runs once immediately and once after this pause.
const BANNER_SWEEP_SETTLE_MS = 700

// Spoofed mobile user agent, used ONLY for hosts that have opted in (see readUaOverrides).
//
// Not applied by default, and deliberately so: claiming to be an Android phone while presenting a
// macOS TLS fingerprint is a contradiction that WAFs punish with a 403, and measurement showed it
// changes nothing on a responsive site. But some platforms decide their markup server-side from the
// UA string alone and never look at the viewport — upwardphysiotherapy.com.au (Wix) rendered six
// top-level links and no hamburger at 390px until the UA read Android. This is the escape hatch for
// those, kept per-host so the downside only ever applies where it is needed.
const MOBILE_USER_AGENT =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

// Sent alongside the UA string so `navigator.userAgentData.mobile` agrees with it. Without this a
// site that branches on Client Hints instead of parsing the UA string would still see a desktop
// browser, and the override would look like it had not worked.
const MOBILE_USER_AGENT_METADATA = {
    platform: 'Android',
    platformVersion: '13',
    architecture: '',
    model: 'Pixel 7',
    mobile: true,
    brands: [
        { brand: 'Not_A Brand', version: '8' },
        { brand: 'Chromium', version: '120' },
        { brand: 'Google Chrome', version: '120' },
    ],
}

const CACHE_DIR = path.join(tmpdir(), 'practice-provider-hero')
const PROFILE_DIR = path.join(CACHE_DIR, 'chrome-profile')
const BROWSER_STATE_KEY = '__practiceProviderHeroBrowser'
const EXIT_HOOK_KEY = '__practiceProviderHeroExitHook'
const SESSION_KEY = '__practiceProviderHeroSessions'
const SESSION_TTL_MS = 15 * 60 * 1000

// Reviewed captures are also written into public/ so the directory can reuse an
// approved image later. The runtime tmp cache stays the fast path; this copy is the
// durable artifact. Mirrors the existing public/allied-health/OT asset convention.
const PUBLIC_DIR = path.join(process.cwd(), 'public', 'allied-health', 'provider-heroes')
const PUBLIC_PREFIX = PROVIDER_HERO_PUBLIC_PREFIX
const MANIFEST_FILE = path.join(PUBLIC_DIR, 'index.json')
// Per-host user-agent opt-ins, kept beside the assets so all of the review state is inspectable in
// one folder, like unreachable.json.
const UA_OVERRIDES_FILE = path.join(PUBLIC_DIR, 'ua-overrides.json')

// Exported so the review layer (approved/unreachable bookkeeping) works against the same folder
// rather than re-deriving the path.
export const PROVIDER_HERO_PUBLIC_DIR = PUBLIC_DIR
export const PROVIDER_HERO_MANIFEST_FILE = MANIFEST_FILE

const CHROME_CANDIDATES = {
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
    linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
    ],
    win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
}

// Flags shared by both modes. The permission, translate, and crash-restore switches
// exist to keep Chrome's own bubbles out of the reviewed screenshot.
const CHROME_FLAGS = [
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--deny-permission-prompts',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--mute-audio',
]

const HEADLESS_FLAGS = ['--headless=new']

// A headed window still needs a physical size. The emulated 390x844 viewport is what
// gets captured, so this only controls how much of it the reviewer can see at once.
const HEADED_WINDOW_SIZE = '520,980'

/**
 * Resolve the Chrome binary to drive. `CHROME_PATH` wins so a deployment or a
 * non-standard install can point at its own build.
 */
export function resolveChromePath() {
    const configured = String(process.env.CHROME_PATH || '').trim()
    if (configured && existsSync(configured)) return configured

    const candidates = CHROME_CANDIDATES[process.platform] || []
    const found = candidates.find((candidate) => existsSync(candidate))
    if (found) return found

    throw new Error('No Chrome or Chromium binary found. Set CHROME_PATH to enable provider screenshots.')
}

/**
 * Only public http(s) hosts may be captured. This keeps the capture route from
 * being used to probe localhost or private-network addresses.
 */
export function normalizeCapturableUrl(value) {
    let url
    try {
        url = new URL(String(value || '').trim())
    } catch {
        throw new Error('Invalid website URL')
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http and https website URLs can be captured')
    }

    const hostname = url.hostname.toLowerCase()
    if (!hostname) throw new Error('Invalid website URL')
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
        throw new Error('Local addresses cannot be captured')
    }
    if (hostname.includes(':')) {
        throw new Error('IPv6 addresses cannot be captured')
    }

    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        const [first, second] = hostname.split('.').map(Number)
        const isPrivate =
            first === 0 ||
            first === 10 ||
            first === 127 ||
            (first === 192 && second === 168) ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31)
        if (isPrivate) throw new Error('Private addresses cannot be captured')
    }

    return url.toString()
}

function cacheFileFor(url, mobileUserAgent = false) {
    // The viewport and banner-hiding rules are part of the key, so changing either produces a
    // fresh render rather than serving an image at a size — or with chrome — the card no longer expects.
    // The rules contribute a fingerprint of their own contents, so editing them re-captures automatically.
    // The user-agent mode is in the key too: the same URL renders differently in each mode, and
    // toggling the override must not keep serving the image captured the other way.
    const digest = createHash('sha1')
        .update(`${url}|${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}|${CAPTURE_REVISION}|${isChromeHidingEnabled() ? BANNER_RULES_FINGERPRINT : 'raw'}|${mobileUserAgent ? 'ua-mobile' : 'ua-native'}`)
        .digest('hex')
    return path.join(CACHE_DIR, `${digest}.png`)
}

/**
 * Stable file name for a provider's reviewed capture.
 *
 * Keyed on the hostname because that is what the capture itself is keyed on, so the
 * directory can derive the same path from a provider record with no lookup or state to
 * keep in sync. Falls back to a hash when the URL is unusable.
 */
export function providerHeroAssetName(value) {
    let hostname = ''
    try {
        hostname = new URL(String(value || '').trim()).hostname
    } catch {
        hostname = ''
    }

    const slug = hostname
        .replace(/^www\./, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()

    if (slug) return `${slug}.png`
    return `provider-${createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12)}.png`
}

/** Public URL for a provider's reviewed capture, whether or not it exists yet. */
export function providerHeroAssetUrl(value) {
    return `${PUBLIC_PREFIX}/${providerHeroAssetName(value)}`
}

/**
 * Read a JSON file, falling back to a default when it is missing or unreadable.
 *
 * A local copy of the helper in providerHeroReview.js: that module imports this one, so sharing it
 * would mean a circular import. Six lines is cheaper than the cycle.
 */
async function readJsonFile(file, fallback) {
    try {
        const parsed = JSON.parse(await readFile(file, 'utf8'))
        return parsed && typeof parsed === 'object' ? parsed : fallback
    } catch {
        return fallback
    }
}

/** Per-host user-agent opt-ins, keyed by bare hostname. */
export async function readUaOverrides() {
    const data = await readJsonFile(UA_OVERRIDES_FILE, { sites: {} })
    return data.sites && typeof data.sites === 'object' ? data.sites : {}
}

/** Should this URL be captured with the mobile user agent? */
async function usesMobileUserAgent(url) {
    const hostname = providerHeroHostname(url)
    if (!hostname) return false

    const sites = await readUaOverrides()
    return sites[hostname]?.mobileUserAgent === true
}

/**
 * Turn the mobile user agent on or off for one host.
 *
 * Flipping it changes the capture cache key, so the next request renders afresh rather than serving
 * an image that was captured the other way.
 */
export async function setUaOverride(websiteUrl, enabled, { provider, providerId } = {}) {
    const hostname = providerHeroHostname(websiteUrl)
    if (!hostname) throw new Error('A valid website URL is required')

    const sites = await readUaOverrides()

    if (enabled) {
        sites[hostname] = {
            host: hostname,
            mobileUserAgent: true,
            provider: String(provider || '').trim().slice(0, 200),
            providerId: providerId ?? null,
            websiteUrl: String(websiteUrl || '').trim(),
            updatedAt: new Date().toISOString(),
        }
    } else {
        delete sites[hostname]
    }

    await mkdir(PUBLIC_DIR, { recursive: true })
    await writeFile(
        UA_OVERRIDES_FILE,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), sites }, null, 2)}\n`,
    )

    return { hostname, mobileUserAgent: Boolean(enabled) }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readCachedCapture(filePath) {
    try {
        const info = await stat(filePath)
        if (Date.now() - info.mtimeMs > CACHE_TTL_MS) return null
        return await readFile(filePath)
    } catch {
        return null
    }
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

    // Without this, a browser that dies mid-command leaves its callers awaiting forever.
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
            if (message.error) reject(new Error(message.error.message || 'Chrome DevTools command failed'))
            else resolve(message.result)
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

async function launchBrowser(mode = 'headless') {
    const chromePath = resolveChromePath()
    await mkdir(PROFILE_DIR, { recursive: true })

    const portFile = path.join(PROFILE_DIR, 'DevToolsActivePort')
    // The profile persists between runs, so the port file from the previous launch would
    // otherwise be read as the current one.
    await rm(portFile, { force: true })

    const modeFlags = mode === 'headed' ? [`--window-size=${HEADED_WINDOW_SIZE}`] : HEADLESS_FLAGS
    const child = spawn(
        chromePath,
        [...CHROME_FLAGS, ...modeFlags, '--remote-debugging-port=0', `--user-data-dir=${PROFILE_DIR}`, 'about:blank'],
        { stdio: 'ignore' },
    )

    // Don't leave a Chrome behind once the dev server or build process exits.
    if (!globalThis[EXIT_HOOK_KEY]) {
        globalThis[EXIT_HOOK_KEY] = true
        process.once('exit', () => {
            try {
                globalThis[BROWSER_STATE_KEY]?.child?.kill('SIGKILL')
            } catch {
                // Already gone.
            }
        })
    }

    const shutdown = async () => {
        if (child.exitCode !== null || child.signalCode !== null) return
        const exited = new Promise((resolve) => child.once('exit', resolve))
        try {
            child.kill('SIGKILL')
        } catch {
            // Already exited.
        }
        // Chrome must fully release the profile before the next launch can use it.
        await Promise.race([exited, delay(4000)])
    }

    try {
        const port = await readDevToolsPort(portFile)
        const response = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (!response.ok) throw new Error('Chrome DevTools endpoint is unavailable')
        const { webSocketDebuggerUrl } = await response.json()

        const socket = await openSocket(webSocketDebuggerUrl)
        const client = createCdpClient(socket)
        socket.addEventListener('close', () => {
            if (globalThis[BROWSER_STATE_KEY]?.client === client) globalThis[BROWSER_STATE_KEY] = null
        })

        return { client, child, mode, shutdown }
    } catch (error) {
        await shutdown()
        throw error
    }
}

async function shutdownBrowser() {
    const state = globalThis[BROWSER_STATE_KEY]
    globalThis[BROWSER_STATE_KEY] = null
    if (!state) return
    await state.shutdown().catch(() => { })
}

/**
 * Reuse one Chrome process across requests. Spawning per capture would burn a few
 * hundred MB per card, and each request here needs three captures. The handle lives
 * on globalThis so Next.js dev hot reloads reuse it instead of leaking processes.
 *
 * Both modes cannot share the profile at once, so switching modes restarts Chrome.
 * Callers must only request a different mode when no review session is open.
 */
async function getBrowser(mode = 'headless') {
    const existing = globalThis[BROWSER_STATE_KEY]
    if (existing?.client && existing.mode === mode) return existing

    await shutdownBrowser()
    const created = await launchBrowser(mode)
    globalThis[BROWSER_STATE_KEY] = created
    return created
}

/**
 * For automated captures: reuse whichever browser is already running, even if a
 * reviewer has it open in headed mode. Never switch modes here — that would tear
 * down the window the human is working in.
 */
async function acquireBrowser() {
    const existing = globalThis[BROWSER_STATE_KEY]
    if (existing?.client) return existing
    return getBrowser('headless')
}

/**
 * Open a blank target locked to the mobile viewport, ready for navigation.
 *
 * The user agent is NOT overridden by default. A blanket spoofed mobile UA is a lie the rest of the
 * fingerprint contradicts (our TLS and platform are macOS), and WAFs that cross-check it answer
 * 403 — stepaheadpaediatrics.com.au does exactly that. Measurement across six provider sites found
 * the spoof changed no layout at all: 390px-wide `mobile: true` emulation is what produces the
 * mobile rendering, so for a responsive site it was pure downside.
 *
 * `mobileUserAgent` turns it back on for the hosts that branch on the UA instead of the viewport,
 * driven by ua-overrides.json — see MOBILE_USER_AGENT.
 */
async function openTarget(client, { mobileUserAgent = false } = {}) {
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })

    try {
        const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })

        await client.send('Page.enable', {}, sessionId)
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: VIEWPORT_WIDTH,
            height: VIEWPORT_HEIGHT,
            deviceScaleFactor: DEVICE_SCALE_FACTOR,
            mobile: true,
        }, sessionId)

        if (mobileUserAgent) {
            // Must be set before navigation: a platform that picks its markup server-side from the
            // UA string would never see a later override.
            await client.send('Emulation.setUserAgentOverride', {
                userAgent: MOBILE_USER_AGENT,
                platform: MOBILE_USER_AGENT_METADATA.platform,
                userAgentMetadata: MOBILE_USER_AGENT_METADATA,
            }, sessionId)
        }

        if (isChromeHidingEnabled()) {
            // Registered before navigation, so consent vendors never paint at all.
            await client.send('Page.addScriptToEvaluateOnNewDocument', {
                source: BANNER_HIDE_DOCUMENT_SCRIPT,
            }, sessionId)
        }

        return { targetId, sessionId }
    } catch (error) {
        await client.send('Target.closeTarget', { targetId }).catch(() => { })
        throw error
    }
}

async function closeTarget(client, targetId) {
    await client.send('Target.closeTarget', { targetId }).catch(() => { })
}

async function navigateAndSettle(client, sessionId, url) {
    const loaded = client.once('Page.loadEventFired', sessionId, LOAD_EVENT_WAIT_MS)
    await client.send('Page.navigate', { url }, sessionId)

    // Plenty of practice sites never fire a clean load event (chat widgets, ad
    // blockers), so settle on a timer rather than failing the capture.
    await Promise.race([loaded, delay(LOAD_EVENT_WAIT_MS)]).catch(() => { })
    await delay(NAVIGATION_SETTLE_MS)
    await hideBanners(client, sessionId, url)
}

/**
 * Strip cookie walls, announcement strips and chat launchers before the screenshot is taken.
 *
 * Explicit per-host rules always apply; the generic rules are skipped when
 * PROVIDER_HERO_KEEP_CHROME=1 so a capture can be compared against the raw page.
 */
async function hideBanners(client, sessionId, url) {
    if (!isChromeHidingEnabled() && siteHideRulesFor(url).length === 0) return

    const expression = buildBannerSweepExpression(url)
    const evaluate = () => client.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId).catch(() => null)

    await evaluate()
    await delay(BANNER_SWEEP_SETTLE_MS)
    await evaluate()
}

async function captureTarget(client, sessionId) {
    const { data } = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
    }, sessionId)

    const png = Buffer.from(data, 'base64')
    if (!png || png.length === 0) throw new Error('Chrome returned an empty screenshot')
    return png
}

// Sites that fingerprint automated browsers answer with a bot wall rather than their page, and
// dead domains answer with Chrome's own error page. Caching either would misrepresent the
// provider, so the automatic path rejects them.
const BLOCKED_PAGE_PATTERN =
    /(403\s*-?\s*forbidden|access denied|access to this page is forbidden|attention required|just a moment|enable javascript and cookies to continue|are you a robot|site can.t be reached|dns_probe_finished|err_name_not_resolved|err_connection|connection security|security check|checking your browser|verifying your browser|verifying you are human|verify you are human|unusual traffic)/i

/**
 * Is the page we landed on a bot wall, a challenge interstitial, or a browser error — rather than
 * the provider's content?
 *
 * Covers both a challenge *page* (e.g. "Checking the site connection security") and a non-2xx
 * document, since the same block can come back as either.
 */
async function isBlockedPage(client, sessionId) {
    const { result } = await client.send('Runtime.evaluate', {
        expression: `JSON.stringify({
            status: (performance.getEntriesByType('navigation')[0] || {}).responseStatus || 0,
            title: document.title,
            text: (document.body ? document.body.innerText : '').slice(0, 800)
        })`,
        returnByValue: true,
    }, sessionId).catch(() => ({ result: null }))

    let page
    try {
        page = JSON.parse(result?.value || '{}')
    } catch {
        return false
    }

    if (Number(page.status) >= 400) return true
    return BLOCKED_PAGE_PATTERN.test(`${page.title || ''} ${page.text || ''}`)
}

function blockedPageError() {
    const error = new Error('The site returned a bot-protection page instead of its content')
    error.isBlockedPage = true
    return error
}

async function captureWith(client, url, { mobileUserAgent = false } = {}) {
    const { targetId, sessionId } = await openTarget(client, { mobileUserAgent })

    try {
        await navigateAndSettle(client, sessionId, url)
        if (await isBlockedPage(client, sessionId)) throw blockedPageError()
        return await captureTarget(client, sessionId)
    } finally {
        await closeTarget(client, targetId)
    }
}

// Captures share a single Chrome process, so they run one at a time.
let captureChain = Promise.resolve()

function enqueue(task) {
    const result = captureChain.then(task, task)
    captureChain = result.then(() => { }, () => { })
    return result
}

const inFlight = new Map()

/**
 * Return a PNG buffer of the provider website's mobile above-the-fold view,
 * using the on-disk cache when it is still fresh.
 */
export async function getProviderScreenshot(websiteUrl) {
    const url = normalizeCapturableUrl(websiteUrl)
    const mobileUserAgent = await usesMobileUserAgent(url)
    const filePath = cacheFileFor(url, mobileUserAgent)

    const cached = await readCachedCapture(filePath)
    if (cached) return cached

    const existing = inFlight.get(filePath)
    if (existing) return existing

    const capture = enqueue(async () => {
        const browser = await acquireBrowser()
        let png
        try {
            png = await captureWith(browser.client, url, { mobileUserAgent })
        } catch (error) {
            // Never recycle the browser out from under a reviewer's open window, and a
            // bot wall will not clear on a second attempt.
            if (error?.isBlockedPage || listCaptureSessions().length > 0) throw error

            // A dead browser (crash, dev-server restart) leaves a stale handle behind.
            if (globalThis[BROWSER_STATE_KEY] === browser) globalThis[BROWSER_STATE_KEY] = null
            await browser.shutdown().catch(() => { })

            const retry = await getBrowser('headless')
            png = await captureWith(retry.client, url, { mobileUserAgent })
        }

        await mkdir(CACHE_DIR, { recursive: true })
        await writeFile(filePath, png)
        return png
    }).finally(() => {
        inFlight.delete(filePath)
    })

    inFlight.set(filePath, capture)
    return capture
}

// ---------------------------------------------------------------------------
// Human review sessions
//
// A session is a live, visible Chrome window parked on a provider's site. The
// reviewer dismisses whatever they want, then commits: whatever is on screen at
// commit time is what gets cached, so the screenshot always matches what a human
// approved. Sessions expire so an abandoned window cannot hold the browser forever.
// ---------------------------------------------------------------------------

function activeSessions() {
    const existing = globalThis[SESSION_KEY]
    if (existing instanceof Map) return existing
    const created = new Map()
    globalThis[SESSION_KEY] = created
    return created
}

function pruneSessions() {
    const sessions = activeSessions()
    const now = Date.now()

    for (const [id, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL_MS) {
            sessions.delete(id)
            session.close().catch(() => { })
        }
    }

    return sessions
}

export function listCaptureSessions() {
    return Array.from(pruneSessions().values()).map((session) => ({
        sessionId: session.id,
        url: session.url,
        createdAt: session.createdAt,
    }))
}

/**
 * Open a provider site in a visible, mobile-emulated Chrome window for review.
 * Switching the shared browser to headed mode restarts Chrome, so any queued
 * automatic captures are drained first.
 */
export async function startCaptureSession(websiteUrl) {
    const url = normalizeCapturableUrl(websiteUrl)
    // The reviewer must see the same rendering the automatic path would produce, so the override
    // follows the host into the headed window rather than only applying to automated captures.
    const mobileUserAgent = await usesMobileUserAgent(url)

    await captureChain
    const sessions = pruneSessions()

    // Reuse the headed browser when a review is already in progress.
    const browser = sessions.size > 0 && globalThis[BROWSER_STATE_KEY]?.mode === 'headed'
        ? globalThis[BROWSER_STATE_KEY]
        : await getBrowser('headed')

    const { targetId, sessionId: cdpSessionId } = await openTarget(browser.client, { mobileUserAgent })

    try {
        await browser.client.send('Page.bringToFront', {}, cdpSessionId).catch(() => { })
        await navigateAndSettle(browser.client, cdpSessionId, url)
        await browser.client.send('Page.bringToFront', {}, cdpSessionId).catch(() => { })
    } catch (error) {
        await closeTarget(browser.client, targetId)
        throw error
    }

    const id = randomUUID()
    sessions.set(id, {
        id,
        url,
        mobileUserAgent,
        createdAt: Date.now(),
        targetId,
        cdpSessionId,
        async close() {
            await closeTarget(browser.client, targetId)
        },
    })

    return { sessionId: id, url }
}

/**
 * Merge one saved capture into public/allied-health/provider-heroes/index.json.
 *
 * File names already encode the hostname, but the manifest lets the directory (or a
 * human browsing the folder) map an asset back to a provider without re-deriving it.
 */
async function writeManifestEntry({ file, bytes, capturedAt, provider, providerId, websiteUrl }) {
    let manifest = { assets: {} }

    try {
        const existing = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'))
        if (existing && typeof existing === 'object' && existing.assets && typeof existing.assets === 'object') {
            manifest = existing
        }
    } catch {
        // No manifest yet, or it is unreadable — start a fresh one.
    }

    manifest.generatedAt = new Date(capturedAt).toISOString()
    manifest.assets[file] = {
        file,
        url: `${PUBLIC_PREFIX}/${file}`,
        provider: String(provider || '').trim().slice(0, 200),
        providerId: providerId ?? null,
        websiteUrl,
        bytes,
        capturedAt: new Date(capturedAt).toISOString(),
    }

    await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Write one approved capture into public/ and record it in the manifest.
 * Shared by both approval paths: review-then-commit, and approving what is already on screen.
 */
async function persistApprovedCapture(png, url, { provider, providerId } = {}) {
    const capturedAt = Date.now()
    const assetName = providerHeroAssetName(url)

    await mkdir(PUBLIC_DIR, { recursive: true })
    await writeFile(path.join(PUBLIC_DIR, assetName), png)
    await writeManifestEntry({
        file: assetName,
        bytes: png.length,
        capturedAt,
        provider,
        providerId,
        websiteUrl: url,
    })

    return { bytes: png.length, capturedAt, assetName, assetUrl: `${PUBLIC_PREFIX}/${assetName}` }
}

/**
 * Capture the reviewed window as-is, then persist it in two places: the runtime cache so
 * the card serves instantly, and public/ as the durable, reusable artifact.
 */
export async function commitCaptureSession(sessionId, details = {}) {
    const sessions = pruneSessions()
    const session = sessions.get(String(sessionId || ''))
    if (!session) throw new Error('That review window has expired. Start a new review.')

    const browser = globalThis[BROWSER_STATE_KEY]
    if (!browser?.client) throw new Error('The review browser is no longer running.')

    try {
        const png = await enqueue(() => captureTarget(browser.client, session.cdpSessionId))

        await mkdir(CACHE_DIR, { recursive: true })
        await writeFile(cacheFileFor(session.url, session.mobileUserAgent), png)

        return await persistApprovedCapture(png, session.url, details)
    } finally {
        sessions.delete(session.id)
        await session.close()
    }
}

/**
 * Approve a screenshot that is already on screen, without opening a browser window.
 *
 * For the common case where the automatic capture is good enough as-is. The already-cached
 * image is promoted into public/, so approving costs no new capture while the cache is fresh.
 */
export async function approveProviderScreenshot(websiteUrl, details = {}) {
    const url = normalizeCapturableUrl(websiteUrl)
    const mobileUserAgent = await usesMobileUserAgent(url)

    // Must look in the same slot the card was served from, or approving a mobile-UA render would
    // promote whatever the native-UA capture happened to be.
    const cached = await readCachedCapture(cacheFileFor(url, mobileUserAgent))
    const png = cached || await getProviderScreenshot(url)

    return persistApprovedCapture(png, url, details)
}

export async function cancelCaptureSession(sessionId) {
    const sessions = pruneSessions()
    const session = sessions.get(String(sessionId || ''))
    if (!session) return false

    sessions.delete(session.id)
    await session.close()
    return true
}
