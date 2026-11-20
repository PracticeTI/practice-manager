/**
 * Register the `@/` alias resolver for scripts run with plain Node:
 *
 *   node --import ./scripts/alias-hooks.mjs scripts/db-init.mjs
 */

import { register } from 'node:module'

register('./alias-resolve.mjs', import.meta.url)
