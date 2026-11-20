import { NextResponse } from 'next/server'
import dns from 'node:dns/promises'
import net from 'node:net'

const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_PATHS = ['/api/health', '/api/email/queue']
const DEFAULT_COMPARE_HOSTS = String(process.env.DOMAIN_BACKEND_COMPARE_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizeOrigin(rawValue) {
    if (!rawValue) return null

    const value = String(rawValue).trim()
    if (!value) return null

    try {
        const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)
            ? value
            : `https://${value}`
        return new URL(withProtocol).origin
    } catch {
        return null
    }
}

function getAllowedHosts(configuredOrigin) {
    const hosts = new Set(DEFAULT_COMPARE_HOSTS)
    if (configuredOrigin) {
        try {
            hosts.add(new URL(configuredOrigin).hostname)
        } catch {
            // Ignore malformed configured URL.
        }
    }
    return hosts
}

function normalizeHostList(rawHosts, allowedHosts) {
    if (!rawHosts) return []

    const out = []
    const parts = String(rawHosts)
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)

    for (const host of parts) {
        if (allowedHosts.has(host) && !out.includes(host)) {
            out.push(host)
        }
    }

    return out
}

function parseTimeout(rawTimeout) {
    const n = Number(rawTimeout)
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS
    return Math.min(Math.max(Math.floor(n), 1000), 20000)
}

function pickHeaders(headers) {
    const keep = [
        'content-type',
        'content-length',
        'server',
        'via',
        'x-vercel-id',
        'x-powered-by',
        'www-authenticate',
    ]

    const out = {}
    for (const key of keep) {
        const value = headers.get(key)
        if (value) out[key] = value
    }
    return out
}

function summarizeBody(text) {
    if (!text) return ''
    return text.slice(0, 240).replace(/\s+/g, ' ').trim()
}

async function fetchProbe(url, timeoutMs) {
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
                Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
            },
        })

        const bodyText = await response.text().catch(() => '')
        const durationMs = Date.now() - startedAt

        return {
            url,
            ok: response.ok,
            status: response.status,
            durationMs,
            headers: pickHeaders(response.headers),
            bodySnippet: summarizeBody(bodyText),
        }
    } catch (error) {
        const durationMs = Date.now() - startedAt
        const isTimeout = error?.name === 'AbortError'
        const cause = error?.cause || {}

        return {
            url,
            ok: false,
            status: null,
            durationMs,
            timeout: isTimeout,
            errorName: error?.name || 'Error',
            errorMessage: error?.message || 'Unknown error',
            errorCode: cause.code || error?.code || null,
            errorErrno: cause.errno || error?.errno || null,
            errorAddress: cause.address || null,
            errorPort: cause.port || null,
        }
    } finally {
        clearTimeout(timeoutId)
    }
}

async function resolveDns(hostname) {
    const [ipv4, ipv6] = await Promise.allSettled([
        dns.resolve4(hostname),
        dns.resolve6(hostname),
    ])

    return {
        hostname,
        ipv4: ipv4.status === 'fulfilled' ? ipv4.value : [],
        ipv6: ipv6.status === 'fulfilled' ? ipv6.value : [],
        ipv4Error:
            ipv4.status === 'rejected'
                ? ipv4.reason?.code || ipv4.reason?.message || 'resolve4 failed'
                : null,
        ipv6Error:
            ipv6.status === 'rejected'
                ? ipv6.reason?.code || ipv6.reason?.message || 'resolve6 failed'
                : null,
    }
}

async function tcpConnectProbe({ address, family, port = 443, timeoutMs = 6000 }) {
    const startedAt = Date.now()

    return new Promise((resolve) => {
        const socket = net.connect({ host: address, port, family })
        let settled = false

        const finalize = (payload) => {
            if (settled) return
            settled = true
            socket.destroy()
            resolve({
                address,
                family,
                port,
                durationMs: Date.now() - startedAt,
                ...payload,
            })
        }

        socket.setTimeout(timeoutMs)

        socket.once('connect', () => {
            finalize({ ok: true })
        })

        socket.once('timeout', () => {
            finalize({ ok: false, timeout: true, errorCode: 'SOCKET_TIMEOUT' })
        })

        socket.once('error', (error) => {
            finalize({
                ok: false,
                timeout: false,
                errorCode: error?.code || 'SOCKET_ERROR',
                errorErrno: error?.errno || null,
                errorMessage: error?.message || 'Socket connect failed',
            })
        })
    })
}

async function runTcpConnectivityChecks(dnsInfo, timeoutMs) {
    const ipv4Checks = dnsInfo.ipv4.map((address) =>
        tcpConnectProbe({ address, family: 4, timeoutMs })
    )
    const ipv6Checks = dnsInfo.ipv6.map((address) =>
        tcpConnectProbe({ address, family: 6, timeoutMs })
    )

    const [ipv4, ipv6] = await Promise.all([
        Promise.all(ipv4Checks),
        Promise.all(ipv6Checks),
    ])

    return {
        port: 443,
        ipv4,
        ipv6,
    }
}

function buildHints(results, dnsInfo, tcpConnectivity) {
    const hints = []
    const hasTimeout = results.some((r) => r.timeout)
    const hasConnectTimeout = results.some((r) => r.errorCode === 'UND_ERR_CONNECT_TIMEOUT')
    const hasNetworkUnreachable = results.some((r) => r.errorCode === 'ENETUNREACH')
    const hasConnectionRefused = results.some((r) => r.errorCode === 'ECONNREFUSED')
    const has403 = results.some((r) => r.status === 401 || r.status === 403)
    const has404 = results.some((r) => r.status === 404)
    const hasAnySuccess = results.some((r) => r.ok)
    const tcp4Ok = tcpConnectivity.ipv4.some((r) => r.ok)
    const tcp6Ok = tcpConnectivity.ipv6.some((r) => r.ok)
    const tcp4Tmo = tcpConnectivity.ipv4.some((r) => !r.ok && (r.timeout || r.errorCode === 'SOCKET_TIMEOUT'))
    const tcp6Tmo = tcpConnectivity.ipv6.some((r) => !r.ok && (r.timeout || r.errorCode === 'SOCKET_TIMEOUT'))
    const dnsFailed =
        !dnsInfo.ipv4.length && !dnsInfo.ipv6.length && (dnsInfo.ipv4Error || dnsInfo.ipv6Error)

    if (dnsFailed) {
        hints.push('DNS resolution failed from this runtime. Check DDNS record and propagation.')
    }

    if (hasTimeout && !hasAnySuccess) {
        hints.push(
            'All probes timed out. This often means home router/firewall/Traefik is dropping cloud datacenter traffic.'
        )
    }

    if (hasConnectTimeout && !hasAnySuccess) {
        hints.push(
            'TCP connect timed out (UND_ERR_CONNECT_TIMEOUT). Traffic is not reaching the backend listener; check WAN port-forwarding, firewall policy, and IPv6 path (AAAA record).'
        )
    }

    if (tcp4Ok && !tcp6Ok && dnsInfo.ipv6.length) {
        hints.push('Direct TCP checks show IPv4 reachable but IPv6 failing. Prioritize fixing IPv6 routing/firewall or remove AAAA temporarily.')
    }

    if (tcp6Ok && !tcp4Ok && dnsInfo.ipv4.length) {
        hints.push('Direct TCP checks show IPv6 reachable but IPv4 failing. Check IPv4 WAN forwarding/firewall/NAT path.')
    }

    if (!tcp4Ok && !tcp6Ok && (tcp4Tmo || tcp6Tmo)) {
        hints.push('Direct TCP checks timed out for resolved addresses on port 443. This strongly indicates edge network drop before Traefik/app handling.')
    }

    if (hasNetworkUnreachable && !hasAnySuccess) {
        hints.push('Network unreachable (ENETUNREACH) suggests an IPv6 routing issue. Temporarily remove AAAA or fix IPv6 route/firewall.')
    }

    if (hasConnectionRefused && !hasAnySuccess) {
        hints.push('Connection refused (ECONNREFUSED) means the host is reachable but no process is accepting connections on that target port.')
    }

    if (has403 && !hasAnySuccess) {
        hints.push('Received 401/403. Health routes may be behind auth middleware (Authelia) from this source.')
    }

    if (has404 && !hasAnySuccess) {
        hints.push('Received 404 on expected endpoints. Confirm route paths exist on backend and reverse proxy forwards /api/*.')
    }

    if (!hints.length && hasAnySuccess) {
        hints.push('At least one endpoint is reachable from this environment.')
    }

    if (!hints.length) {
        hints.push('No clear signature. Inspect per-endpoint errors below for network or proxy clues.')
    }

    return hints
}

function summarizeHostOutcome({ probes, tcpConnectivity }) {
    const httpOk = probes.some((p) => p.ok)
    const tcp4Ok = tcpConnectivity.ipv4.some((r) => r.ok)
    const tcp6Ok = tcpConnectivity.ipv6.some((r) => r.ok)
    const hasConnectTimeout = probes.some((p) => p.errorCode === 'UND_ERR_CONNECT_TIMEOUT')

    return {
        httpOk,
        tcp4Ok,
        tcp6Ok,
        hasConnectTimeout,
    }
}

function buildCrossHostHints(hostReports, primaryHost) {
    const hints = []
    const primary = hostReports[primaryHost]
    if (!primary) return hints

    const primaryOutcome = summarizeHostOutcome(primary)

    for (const [host, report] of Object.entries(hostReports)) {
        if (host === primaryHost) continue
        const other = summarizeHostOutcome(report)

        if (!primaryOutcome.httpOk && other.httpOk) {
            hints.push(
                `Host differential detected: ${host} returns HTTP successfully while ${primaryHost} does not. This points to hostname-specific Traefik router/middleware/policy behavior rather than generic WAN connectivity.`
            )
        }

        if (!primaryOutcome.tcp4Ok && !primaryOutcome.tcp6Ok && (other.tcp4Ok || other.tcp6Ok)) {
            hints.push(
                `TCP differential detected: ${host} accepts TCP while ${primaryHost} times out. Check edge ACLs, SNI/hostname routing, or per-host firewall rules.`
            )
        }

        if (primaryOutcome.hasConnectTimeout && !other.hasConnectTimeout) {
            hints.push(
                `Connect-timeout is specific to ${primaryHost} compared with ${host}. Investigate host-specific router forwarding and Traefik entry routing.`
            )
        }
    }

    return hints
}

async function runOriginDiagnostics(origin, timeoutMs) {
    const host = new URL(origin).hostname
    const endpointUrls = DEFAULT_PATHS.map((path) => `${origin}${path}`)
    const dnsInfo = await resolveDns(host)

    const [probeResults, tcpConnectivity] = await Promise.all([
        Promise.all(endpointUrls.map((url) => fetchProbe(url, timeoutMs))),
        runTcpConnectivityChecks(dnsInfo, Math.min(timeoutMs, 12000)),
    ])

    const hints = buildHints(probeResults, dnsInfo, tcpConnectivity)

    return {
        host,
        origin,
        dns: dnsInfo,
        tcpConnectivity,
        probes: probeResults,
        hints,
    }
}

export async function GET(request) {
    const requiredToken = process.env.DOMAIN_BACKEND_DIAG_TOKEN
    const suppliedToken =
        request.nextUrl.searchParams.get('token') || request.headers.get('x-diagnostic-token')

    if (requiredToken && suppliedToken !== requiredToken) {
        return NextResponse.json(
            {
                ok: false,
                error: 'Unauthorized diagnostic access.',
            },
            { status: 401 }
        )
    }

    const configuredOrigin = normalizeOrigin(process.env.DOMAIN_BACKEND_URL)
    const fallbackOrigin = DEFAULT_COMPARE_HOSTS[0] ? `https://${DEFAULT_COMPARE_HOSTS[0]}` : ''
    const requestedTarget = request.nextUrl.searchParams.get('target')
    const timeoutMs = parseTimeout(request.nextUrl.searchParams.get('timeoutMs'))
    const compareHostsRaw = request.nextUrl.searchParams.get('compareHosts')
    const compareDefault = request.nextUrl.searchParams.get('compareDefaultHosts') === '1'

    const requestedOrigin = normalizeOrigin(requestedTarget)
    const candidateOrigin = requestedOrigin || configuredOrigin || fallbackOrigin

    const allowedHosts = getAllowedHosts(configuredOrigin)
    const candidateHost = new URL(candidateOrigin).hostname

    if (!allowedHosts.has(candidateHost)) {
        return NextResponse.json(
            {
                ok: false,
                error: 'Target host is not allowed for this diagnostic endpoint.',
                allowedHosts: Array.from(allowedHosts),
            },
            { status: 400 }
        )
    }

    const hostReports = {}
    const primaryReport = await runOriginDiagnostics(candidateOrigin, timeoutMs)
    hostReports[candidateHost] = primaryReport

    const compareHosts = compareDefault
        ? DEFAULT_COMPARE_HOSTS.filter((host) => allowedHosts.has(host) && host !== candidateHost)
        : normalizeHostList(compareHostsRaw, allowedHosts).filter((host) => host !== candidateHost)

    if (compareHosts.length) {
        const compareReports = await Promise.all(
            compareHosts.map((host) => runOriginDiagnostics(`https://${host}`, timeoutMs))
        )

        for (const report of compareReports) {
            hostReports[report.host] = report
        }
    }

    const hints = [
        ...primaryReport.hints,
        ...buildCrossHostHints(hostReports, candidateHost),
    ]

    return NextResponse.json({
        ok: true,
        now: new Date().toISOString(),
        target: {
            configuredOrigin,
            probedOrigin: candidateOrigin,
            host: candidateHost,
            comparedHosts: compareHosts,
        },
        runtime: {
            vercel: process.env.VERCEL === '1',
            region: process.env.VERCEL_REGION || null,
            deploymentUrl: process.env.VERCEL_URL || null,
            nodeEnv: process.env.NODE_ENV || null,
            timeoutMs,
        },
        dns: primaryReport.dns,
        tcpConnectivity: primaryReport.tcpConnectivity,
        probes: primaryReport.probes,
        hostReports,
        hints,
    })
}
