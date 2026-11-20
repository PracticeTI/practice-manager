'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAdminSetupStatus, getOrCreateAdminTokenForLocalhost, persistAdminSession } from '@/lib/clientAdminAuth'

export default function LoginPage() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [credentialsConfigured, setCredentialsConfigured] = useState(null)
    const [isLocalhost, setIsLocalhost] = useState(false)
    const [isProduction, setIsProduction] = useState(false)
    const [setupMode, setSetupMode] = useState(false)
    const [checkingAuth, setCheckingAuth] = useState(true)
    const router = useRouter()

    async function checkSetupStatus() {
        try {
            const data = await getAdminSetupStatus({ forceRefresh: true })
            if (!data) {
                return null
            }

            setCredentialsConfigured(data.configured)
            setIsLocalhost(data.isLocalhost)
            setIsProduction(data.isProduction || data.isVercel)

            if (!data.configured && data.isLocalhost) {
                setSetupMode(true)
            }

            setCheckingAuth(false)
            return data
        } catch (err) {
            console.error('Failed to check setup status:', err)
            return null
        }
    }

    useEffect(() => {
        let cancelled = false

        async function bootstrapAuth() {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (cancelled) {
                return
            }

            if (token) {
                router.replace('/admin')
                return
            }

            const setupStatus = await checkSetupStatus()
            if (!cancelled && !setupStatus) {
                setCheckingAuth(false)
            }
        }

        bootstrapAuth()

        return () => {
            cancelled = true
        }
    }, [router])

    const handleSetupSubmit = async (e) => {
        e.preventDefault()
        setError('')

        if (!username || !password) {
            setError('Username and password are required')
            return
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match')
            return
        }

        setLoading(true)

        try {
            const response = await fetch('/api/auth/setup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            })

            const data = await response.json()

            if (response.ok && data.success) {
                setError('')
                alert('Admin credentials saved successfully! Please restart your admin server to apply changes.')
                setSetupMode(false)
                window.location.reload()
            } else if (data.isProduction) {
                setError(data.message)
            } else {
                setError(data.error || 'Setup failed')
            }
        } catch (err) {
            setError('An error occurred. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const handleLoginSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            })

            const data = await response.json()

            if (response.ok) {
                persistAdminSession(data.token, username)
                router.replace('/admin')
            } else {
                setError(data.error || 'Login failed')
            }
        } catch (err) {
            setError('An error occurred. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    if (checkingAuth) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="text-gray-600 text-sm">Checking session...</div>
            </div>
        )
    }

    if (setupMode && isLocalhost) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="border border-gray-300 p-8 w-full max-w-md">
                    <div className="text-center mb-8">
                        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Admin Setup Required</h1>
                        <p className="text-gray-600 text-sm">Create your admin credentials to get started</p>
                    </div>

                    <form onSubmit={handleSetupSubmit} className="space-y-5">
                        <div>
                            <label htmlFor="setup-username" className="block text-sm font-medium text-gray-700 mb-1">
                                Username
                            </label>
                            <input
                                id="setup-username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                                placeholder="Choose a username (min 3 chars)"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="setup-password" className="block text-sm font-medium text-gray-700 mb-1">
                                Password
                            </label>
                            <input
                                id="setup-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                                placeholder="Choose a password (min 6 chars)"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="setup-confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                                Confirm Password
                            </label>
                            <input
                                id="setup-confirm-password"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                                placeholder="Confirm your password"
                                required
                            />
                        </div>

                        {error && (
                            <div className="border border-gray-400 bg-white text-gray-900 px-3 py-2 text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-gray-900 text-white py-2 px-4 hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                        >
                            {loading ? 'Setting up...' : 'Create Admin Account'}
                        </button>
                    </form>

                    <div className="mt-6 p-4 bg-gray-50 border border-gray-300">
                        <p className="text-xs text-gray-600">
                            <strong>Note:</strong> Credentials will be saved to <code className="bg-gray-100 px-1">.env.local</code> in your project root. Restart your admin server to apply changes.
                        </p>
                    </div>
                </div>
            </div>
        )
    }

    if (credentialsConfigured === false && isProduction) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="border border-gray-300 p-8 w-full max-w-2xl">
                    <div className="text-center mb-8">
                        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Admin Credentials Required</h1>
                        <p className="text-gray-600 text-sm">Set environment variables on your hosting platform</p>
                    </div>

                    <div className="space-y-6">
                        <div className="border border-gray-300 p-4">
                            <h2 className="font-semibold text-gray-900 mb-3">Vercel</h2>
                            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                                <li>Go to your <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Vercel dashboard</a></li>
                                <li>Select your project</li>
                                <li>Navigate to Settings → Environment Variables</li>
                                <li>Add <code className="bg-gray-100 px-1">ADMIN_USERNAME</code> with your desired username</li>
                                <li>Add <code className="bg-gray-100 px-1">ADMIN_PASSWORD</code> with your desired password</li>
                                <li>Redeploy your application</li>
                            </ol>
                        </div>

                        <div className="border border-gray-300 p-4">
                            <h2 className="font-semibold text-gray-900 mb-3">Netlify</h2>
                            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                                <li>Go to your <a href="https://app.netlify.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Netlify dashboard</a></li>
                                <li>Select your site</li>
                                <li>Navigate to Site Settings → Build & Deploy → Environment</li>
                                <li>Add <code className="bg-gray-100 px-1">ADMIN_USERNAME</code> with your desired username</li>
                                <li>Add <code className="bg-gray-100 px-1">ADMIN_PASSWORD</code> with your desired password</li>
                                <li>Trigger a new deploy</li>
                            </ol>
                        </div>

                        <div className="border border-gray-300 p-4">
                            <h2 className="font-semibold text-gray-900 mb-3">Railway</h2>
                            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                                <li>Go to your <a href="https://railway.app/dashboard" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Railway dashboard</a></li>
                                <li>Select your project</li>
                                <li>Navigate to Variables</li>
                                <li>Add <code className="bg-gray-100 px-1">ADMIN_USERNAME</code> with your desired username</li>
                                <li>Add <code className="bg-gray-100 px-1">ADMIN_PASSWORD</code> with your desired password</li>
                                <li>Redeploy your application</li>
                            </ol>
                        </div>

                        <div className="p-4 bg-gray-50 border border-gray-300">
                            <p className="text-xs text-gray-600">
                                <strong>After adding environment variables:</strong> Your hosting platform will automatically redeploy with the new credentials. Once deployed, you&apos;ll be able to log in with your username and password.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-white">
            <div className="border border-gray-300 p-8 w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-semibold text-gray-900 mb-2">Admin Portal</h1>
                    <p className="text-gray-600 text-sm">Sign in to manage your content</p>
                </div>

                <form onSubmit={handleLoginSubmit} className="space-y-5">
                    <div>
                        <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                            Username
                        </label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                            placeholder="Enter your username"
                            required
                        />
                    </div>

                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                            placeholder="Enter your password"
                            required
                        />
                    </div>

                    {error && (
                        <div className="border border-gray-400 bg-white text-gray-900 px-3 py-2 text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gray-900 text-white py-2 px-4 hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <div className="mt-6 text-center text-sm text-gray-600">
                    <p></p>
                </div>
            </div>
        </div>
    )
}