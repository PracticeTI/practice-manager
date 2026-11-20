import { NextResponse } from 'next/server'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Save Brave API configuration to .env.local
 * POST /api/brave-api/setup
 */
export async function POST(request) {
    try {
        let bodyData
        try {
            bodyData = await request.json()
        } catch (parseError) {
            console.error('Failed to parse request body:', parseError)
            return NextResponse.json(
                { error: 'Invalid request body: ' + parseError.message },
                { status: 400 }
            )
        }

        const { envVars, adminToken } = bodyData

        if (!adminToken) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }

        if (!envVars || typeof envVars !== 'object') {
            return NextResponse.json(
                { error: 'Invalid environment variables' },
                { status: 400 }
            )
        }

        const apiKey = envVars.BRAVE_API_KEY

        if (!apiKey) {
            return NextResponse.json(
                { error: 'Missing required Brave API key' },
                { status: 400 }
            )
        }

        const isVercel = process.env.VERCEL === '1'
        const isProduction = process.env.NODE_ENV === 'production'

        if (isVercel || isProduction) {
            return NextResponse.json({
                success: false,
                isProduction: true,
                platform: isVercel ? 'vercel' : 'production',
                message: 'Cannot save to .env.local in production environment',
                instructions: {
                    vercel: [
                        'Go to your Vercel dashboard',
                        'Select your project',
                        'Go to Settings > Environment Variables',
                        'Add BRAVE_API_KEY',
                        'Redeploy your application'
                    ],
                    general: [
                        "Add the BRAVE_API_KEY environment variable to your hosting platform's settings",
                        'Redeploy your application for changes to take effect'
                    ]
                },
                envVars
            })
        }

        const envPath = join(process.cwd(), '.env.local')

        let existingContent = ''
        try {
            if (existsSync(envPath)) {
                existingContent = readFileSync(envPath, 'utf-8')
            }
        } catch (readError) {
            console.error('Error reading existing .env.local:', readError)
        }

        const existingVars = {}
        existingContent.split('\n').forEach(line => {
            const trimmed = line.trim()
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=')
                if (key) {
                    existingVars[key.trim()] = valueParts.join('=')
                }
            }
        })

        const mergedVars = { ...existingVars, ...envVars }

        const newLines = Object.entries(mergedVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')

        try {
            writeFileSync(envPath, newLines + '\n', 'utf-8')
            console.log('Brave API configuration saved to .env.local')
        } catch (writeError) {
            console.error('Error writing to .env.local:', writeError)
            return NextResponse.json(
                { error: 'Failed to save configuration: ' + writeError.message },
                { status: 500 }
            )
        }

        return NextResponse.json({
            success: true,
            message: 'Brave API configuration saved successfully',
            note: 'Configuration saved to .env.local. The backend server will need to be restarted for changes to take effect.'
        })
    } catch (error) {
        console.error('Error in Brave API setup:', error)
        return NextResponse.json(
            { error: 'Server error: ' + error.message },
            { status: 500 }
        )
    }
}
