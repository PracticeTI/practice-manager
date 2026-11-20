// `/settings/*` is an alias tree for `/admin/settings/*` — see `settings/page.jsx` and
// `settings/system-state/page.jsx`. The hero review tool is implemented next to the other
// settings tools so it inherits the settings layout; this re-export is the path the Dev Tools
// button on the settings page links to.
export { default, metadata } from '../../admin/settings/hero-review/page'
