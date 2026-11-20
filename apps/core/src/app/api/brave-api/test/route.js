import { NextResponse } from 'next/server'

/**
 * Test Brave API credentials
 * POST /api/brave-api/test
 */
export async function POST(request) {
    try {
        let bodyData = {}
        try {
            bodyData = await request.json()
        } catch {
            // It is OK if there is no body.
        }

        const { apiKey } = bodyData
        const envApiKey = process.env.BRAVE_API_KEY
        const keyToTest = apiKey || envApiKey

        if (!keyToTest) {
            return NextResponse.json(
                {
                    valid: false,
                    error: 'Brave API key not configured',
                    message: 'Missing BRAVE_API_KEY'
                },
                { status: 400 }
            )
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)

        try {
            const response = await fetch(
                'https://api.search.brave.com/res/v1/images/search?q=film+studio+logo&count=1',
                {
                    method: 'GET',
                    headers: {
                        'X-Subscription-Token': keyToTest,
                        'Accept': 'application/json'
                    },
                    signal: controller.signal
                }
            )

            clearTimeout(timeout)

            if (response.ok) {
                const data = await response.json()
                const resultsCount = Array.isArray(data?.results) ? data.results.length : 0

                return NextResponse.json({
                    valid: true,
                    message: 'Brave API is working correctly',
                    tested: true,
                    resultsFound: resultsCount
                })
            }

            const errorData = await response.json().catch(() => ({}))
            let errorMessage = errorData?.error?.detail || errorData?.message || `API error: ${response.status}`

            if (response.status === 401 || response.status === 403) {
                errorMessage = 'Invalid API key. Please check your Brave API key and try again.'
            } else if (response.status === 429) {
                errorMessage = 'Rate limit exceeded. Please try again later.'
            }

            return NextResponse.json(
                {
                    valid: false,
                    error: errorMessage,
                    tested: true
                },
                { status: 400 }
            )
        } catch (fetchError) {
            clearTimeout(timeout)

            if (fetchError.name === 'AbortError') {
                return NextResponse.json(
                    {
                        valid: false,
                        error: 'Request timeout - Brave API took too long to respond'
                    },
                    { status: 408 }
                )
            }

            throw fetchError
        }
    } catch (error) {
        console.error('Error testing Brave API:', error)
        return NextResponse.json(
            { error: 'Server error: ' + error.message },
            { status: 500 }
        )
    }
}
