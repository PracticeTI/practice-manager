# Domain Page Style Templates

The homepage now supports domain-specific style templates, so you can adjust styling per domain without editing component JSX classes directly.

## Location

- Template definitions: `src/lib/domainPageStyles.js`
- Homepage usage: `src/app/page.jsx`

## How It Works

`src/lib/domainPageStyles.js` exports:

- `DOMAIN_PAGE_STYLE_TEMPLATES`:
  - `default`
- `getDomainPageStyles(mode)`: resolves the active style set from the domain mode.

`src/app/page.jsx` uses this resolver:

```js
const pageStyles = useMemo(() => getDomainPageStyles(domainMode), [domainMode])
```

And applies style tokens like:

- `pageStyles.layout.page`
- `pageStyles.layout.container`
- `pageStyles.menu.nav`
- `pageStyles.cards.latestPost`

## Current State

All domain templates currently start with the same copied styles (no visual changes by default).

This gives you a safe baseline to begin per-domain customization.

## Customize A Single Domain

1. Open `src/lib/domainPageStyles.js`.
2. Keep the public `default` styles generic. Domain-specific style overrides belong in the private descriptor.
3. Keep the same keys so `src/app/page.jsx` continues to render correctly.

Example:

```js
const DOMAIN_PAGE_STYLE_OVERRIDES = {
  default: {}
}
```

## Notes

- This is intentionally class-token based (Tailwind utility strings) for minimal runtime overhead.
- Keep style strings scoped to presentation only. Do not place logic or content rules in these templates.
- If new styleable areas are needed, add new keys to the template and consume them in `src/app/page.jsx`.
