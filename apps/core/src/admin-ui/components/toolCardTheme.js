import { History, Landmark, LayoutDashboard, Trash2 } from 'lucide-react'

/**
 * The look of each Tools destination, keyed by the card/shortcut key in
 * `src/lib/adminToolsCards.js`.
 *
 * Both surfaces read these maps — the Tools dashboard (`/admin/tools`) for its
 * card headers, and the Admin dashboard's Tools card for its shortcut rows — so
 * a shortcut cannot show a different glyph or colour from the card it opens. The
 * theme lives here rather than in `adminToolsCards.js` so that data module stays
 * pure enough to unit test without a JSX runtime.
 */

/** The glyph each destination carries. */
export const TOOL_CARD_ICONS = {
    content: LayoutDashboard,
    funders: Landmark,
    recycling: Trash2,
    activities: History,
}

/**
 * The colour each destination is accented with. `rail` is the gradient bar and
 * `band` the light stop that fades `to-white` behind the header, while `tile` is
 * the solid fill behind the white glyph.
 */
export const TOOL_CARD_ACCENTS = {
    content: { rail: 'from-sky-400 to-sky-600', band: 'from-sky-50', tile: 'bg-sky-600', eyebrow: 'text-sky-700', arrow: 'text-sky-600' },
    funders: { rail: 'from-violet-400 to-violet-600', band: 'from-violet-50', tile: 'bg-violet-600', eyebrow: 'text-violet-700', arrow: 'text-violet-600' },
    recycling: { rail: 'from-amber-400 to-amber-600', band: 'from-amber-50', tile: 'bg-amber-500', eyebrow: 'text-amber-700', arrow: 'text-amber-600' },
    activities: { rail: 'from-emerald-400 to-emerald-600', band: 'from-emerald-50', tile: 'bg-emerald-600', eyebrow: 'text-emerald-700', arrow: 'text-emerald-600' },
}
