import { execSync } from 'node:child_process'

const DEFAULT_PORT = 3000
const targetPort = Number.parseInt(process.argv[2] || process.env.PORT || String(DEFAULT_PORT), 10)

if (!Number.isInteger(targetPort) || targetPort <= 0) {
    console.error(`[free-port] Invalid port: ${process.argv[2] || process.env.PORT}`)
    process.exit(1)
}

function isWindows() {
    return process.platform === 'win32'
}

function killPid(pid) {
    if (!pid || Number(pid) === process.pid) {
        return
    }

    try {
        if (isWindows()) {
            execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
        } else {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
        }
        console.log(`[free-port] Killed process ${pid} on port ${targetPort}`)
    } catch {
        // Ignore failures so the next command can still attempt startup.
    }
}

function findPidsOnWindows(port) {
    try {
        const output = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8' })
        const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        const pids = new Set()

        for (const line of lines) {
            if (!line.includes('LISTENING')) {
                continue
            }
            const parts = line.split(/\s+/)
            const pid = parts[parts.length - 1]
            if (pid && /^\d+$/.test(pid)) {
                pids.add(pid)
            }
        }

        return [...pids]
    } catch {
        return []
    }
}

function findPidsOnUnix(port) {
    try {
        const output = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' }).trim()
        if (!output) {
            return []
        }
        return output.split(/\r?\n/).filter(Boolean)
    } catch {
        return []
    }
}

const pids = isWindows() ? findPidsOnWindows(targetPort) : findPidsOnUnix(targetPort)

if (pids.length === 0) {
    console.log(`[free-port] Port ${targetPort} is free`)
    process.exit(0)
}

for (const pid of pids) {
    killPid(pid)
}
