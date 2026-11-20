/**
 * Filesystem half of the RLS route-coverage classification.
 *
 * Build-time only: imported by next.config.js and scripts/rls-coverage.mjs, never
 * by a route handler. The route tree is walked once per build and injected as
 * `PRACTICE_RLS_ROUTE_COVERAGE`, because a serverless deployment has no source
 * tree to inspect at request time.
 */

import fs from 'node:fs'
import path from 'node:path'

import { buildRouteCoverage, classifyRoute } from './rlsRouteCoverage.js'

function walkRouteFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) files.push(...walkRouteFiles(full))
        else if (entry.name === 'route.js') files.push(full)
    }
    return files
}

/** Route path relative to the API root, e.g. `database/chats/[id]`. */
function routeNameOf(apiRoot, file) {
    return path.relative(apiRoot, file).replace(/\/route\.js$/, '').split(path.sep).join('/')
}

/**
 * Classify every `route.js` under `apiRoot`.
 *
 * Returns an empty coverage when the directory cannot be read, so a build without
 * the API tree (and the unit that ships the panel) degrades to "unknown" instead
 * of failing.
 *
 * @param {string} apiRoot absolute path to `src/app/api`
 */
export function collectRouteCoverage(apiRoot) {
    let files = []
    try {
        files = walkRouteFiles(apiRoot)
    } catch {
        return buildRouteCoverage([])
    }

    return buildRouteCoverage(
        files.map((file) => {
            try {
                return classifyRoute({ route: routeNameOf(apiRoot, file), source: fs.readFileSync(file, 'utf8') })
            } catch {
                return null
            }
        })
    )
}
