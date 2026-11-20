import { middleware } from '../middleware.js'

export function proxy(request) {
    return middleware(request)
}

export const config = {
    matcher: ['/', '/((?!favicon.ico|robots.txt|sitemap.xml).*)'],
}
