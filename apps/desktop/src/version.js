/**
 * Version-range checking for the `engines` field.
 *
 * Deliberately small: the project only uses simple comparator ranges
 * (`>=22.13.0 <23 || >=24`), and a desktop app that refuses to start must not depend on a
 * semver package being installed correctly. Anything it does not understand counts as a
 * failed check, so an unparsed range fails loudly instead of silently passing.
 */

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return null
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)]
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}

function satisfiesComparator(version, comparator) {
  const match = String(comparator).trim().match(/^(>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/)
  if (!match) return false

  const operator = match[1] || '='
  const target = parseVersion(match[2])
  const result = compareVersions(version, target)

  switch (operator) {
    case '>=': return result >= 0
    case '<=': return result <= 0
    case '>': return result > 0
    case '<': return result < 0
    default: return result === 0
  }
}

/**
 * True when `version` satisfies `range`, where comparators joined by spaces must all hold
 * and alternatives joined by `||` may each hold.
 *
 * @param {string} version
 * @param {string} range
 * @returns {boolean}
 */
export function satisfiesRange(version, range) {
  const parsed = parseVersion(version)
  if (!parsed) return false

  const alternatives = String(range || '').split('||').map((part) => part.trim()).filter(Boolean)
  if (alternatives.length === 0) return false

  return alternatives.some((alternative) => {
    const comparators = alternative.split(/\s+/).filter(Boolean)
    return comparators.length > 0 && comparators.every((comparator) => satisfiesComparator(parsed, comparator))
  })
}
