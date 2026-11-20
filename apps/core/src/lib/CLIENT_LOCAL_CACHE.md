# Local Caching System

Per-domain, transparent local caching with TTL support. No manual refresh button.

## Features

✅ **Per-domain toggle** — Enable/disable via Admin Settings  
✅ **Configurable TTL** — Default 24 hours (editable per domain)  
✅ **Automatic expiration** — Stale cache cleared on access  
✅ **Silent initialization** — No UI, no refresh button  
✅ **JSON-compatible data** — Cache any serializable content  

## Admin Configuration

1. Go to `/admin/settings/domains`
2. Select a domain (e.g., Acme OT)
3. Check "Enable local caching (24h TTL)" in Features section
4. Save

Cache TTL defaults to 24 hours; adjust `localCacheTtlHours` if needed.

## Usage Examples

### Basic Caching (No Auth Needed)

```javascript
import { getCacheItem, setCacheItem, clearCacheItem } from '@/lib/clientLocalCache'

// Cache content data
export async function MyComponent() {
  const domainKey = 'default'
  const cached = await getCacheItem('content-homepage', domainKey)

  if (cached) {
    // Use cached version
    return <div>{cached.title}</div>
  }

  // Fetch fresh data
  const data = await fetchHomepage()
  await setCacheItem('content-homepage', data, domainKey)

  return <div>{data.title}</div>
}
```

### Clear Cache

```javascript
// Clear single item
clearCacheItem('content-homepage', 'default')

// Clear all for a domain
import { clearCacheForDomain } from '@/lib/clientLocalCache'
clearCacheForDomain('default')

// Clear everything
import { clearAllCache } from '@/lib/clientLocalCache'
clearAllCache()
```

## API

### `getCacheItem(cacheKey, domainKey)`

Returns cached data if valid (not expired and caching enabled); otherwise `null`.

```javascript
const data = await getCacheItem('my-key', 'default')
// Returns: { ...cached data } or null
```

### `setCacheItem(cacheKey, data, domainKey)`

Stores data if caching is enabled for the domain. Returns success boolean.

```javascript
const success = await setCacheItem('my-key', { title: 'Home' }, 'default')
```

### `isCachingEnabled(domainKey)`

Check if caching is enabled for a domain.

```javascript
const enabled = await isCachingEnabled('default')
```

### `getCacheTtlHours(domainKey)`

Get TTL hours configured for a domain.

```javascript
const ttl = await getCacheTtlHours('default')
// Returns: 24 (or custom value)
```

### `clearCacheItem(cacheKey, domainKey)`

Remove a specific cached item.

```javascript
clearCacheItem('my-key', 'default')
```

### `clearCacheForDomain(domainKey)`

Clear all cached items for a domain.

```javascript
clearCacheForDomain('default')
```

### `clearAllCache()`

Clear all cached items across all domains.

```javascript
clearAllCache()
```

## Implementation Details

- **Storage:** Browser `localStorage` with version prefix
- **Keys:** `practice_cache_v1:domain:key` (data) + metadata
- **Expiration:** Checked on every `getCacheItem()` call
- **Safe:** Returns `null` if caching disabled, expired, or on error
- **No UI:** CacheInitializer component runs silently on app startup
- **Async:** All methods are async to fetch domain settings dynamically
- **Public API:** Uses `/api/settings/domains/cache-config` (no auth required) to check cache settings on public pages

## Cache Key Naming

Use descriptive keys for clarity:

```javascript
// ✅ Good
'content-homepage'
'admin-users-list'
'search-results-locations'
'api-branding-settings'

// ❌ Poor
'cache1'
'data'
'temp'
```

## Best Practices

1. **Always check `getCacheItem()` first** before making API calls
2. **Use consistent cache keys** across your codebase
3. **Cache API responses**, not UI state
4. **Set cache after successful fetches** only
5. **Test with caching disabled** to verify fallback behavior
6. **For static content** (pages that rarely change), this is ideal
7. **For dynamic content**, consider shorter TTLs or domain-specific toggles

## Example: Pages That Benefit

- ✅ Static page content (practice programs, descriptions)
- ✅ Location data (updated < daily)
- ✅ Branding/settings (low-change)
- ✅ Public read-only content

## Example: Pages to Avoid

- ❌ Real-time user data (profiles, permissions)
- ❌ High-frequency updates (search results, live feeds)
- ❌ Admin-managed content (use admin token + shorter TTL if caching)

## Debugging

In browser DevTools Console:

```javascript
// Check what's cached
Object.keys(localStorage).filter(k => k.includes('practice_cache'))

// View cached data
JSON.parse(localStorage.getItem('practice_cache_v1:default:my-key'))

// View expiration
JSON.parse(localStorage.getItem('practice_cache_v1_meta:default:my-key'))

// Clear manually
localStorage.clear() // Or clearAllCache()
```

In dev mode, CacheInitializer logs to console:
```
[CacheInitializer] Caching enabled for default (24h TTL)
```
