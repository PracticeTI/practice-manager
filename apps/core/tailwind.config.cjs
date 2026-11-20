/** @type {import('tailwindcss').Config} */

/**
 * Theme extensions supplied by the private overlay (see
 * scripts/sync-private-overlay.mjs). The module is generated and gitignored; without
 * an overlay it exports `{}`, so the open-source build carries no customer palette.
 */
function readPrivateTheme() {
  try {
    const theme = require('./tailwind.private.cjs')
    return theme && typeof theme === 'object' ? theme : {}
  } catch {
    return {}
  }
}

const privateTheme = readPrivateTheme()

module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/admin-ui/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ...(privateTheme.colors || {}),
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        ...(privateTheme.backgroundImage || {}),
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        ...(privateTheme.keyframes || {}),
      },
      animation: {
        'fade-in': 'fade-in 300ms ease-out',
        ...(privateTheme.animation || {}),
      },
    },
  },
  plugins: [],
}