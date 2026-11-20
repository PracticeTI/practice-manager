const HEALTH_WINDOW_MS = 2 * 60 * 60 * 1000

function parseRecord(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export function evaluateEnvironmentHealth(value, now = Date.now()) {
  const record = parseRecord(value)
  const timestamp = typeof record?.timestamp === 'string' ? record.timestamp : null
  const timestampMs = timestamp ? Date.parse(timestamp) : NaN
  const age = now - timestampMs

  return {
    healthy: record?.workersRan === true
      && Number.isFinite(timestampMs)
      && age >= 0
      && age <= HEALTH_WINDOW_MS,
    timestamp: Number.isFinite(timestampMs) ? timestamp : null,
  }
}
