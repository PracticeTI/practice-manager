import { NextResponse } from 'next/server'

/**
 * Check if Brave API is configured
 * GET /api/brave-api/check
 */
export async function GET() {
    try {
        const apiKey = process.env.BRAVE_API_KEY
        const configured = !!apiKey

        const maskedApiKey = configured
            ? `${apiKey.slice(0, 4)}${'*'.repeat(Math.max(apiKey.length - 6, 4))}${apiKey.slice(-2)}`
            : null

        return NextResponse.json({
            configured,
            message: configured ? 'Brave API is configured' : 'Brave API is not configured',
            maskedApiKey
        })
    } catch (error) {
        console.error('Error checking Brave API status:', error)
        return NextResponse.json(
            { error: 'Server error: ' + error.message },
            { status: 500 }
        )
    }
}
