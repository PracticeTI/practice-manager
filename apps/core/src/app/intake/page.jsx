import { headers } from 'next/headers'
import Link from 'next/link'
import { detectDomainFromHostname } from '@/lib/domainMode'
import { resolveIntakeChoice } from '@/lib/nativeIntake'
import { readIntakeSettings, resolvePublicIntakeDomain } from '@/lib/nativeIntakeStore'
import NativeIntakeForm from './NativeIntakeForm'
import SploseIntakeChat from './SploseIntakeChat'

export const metadata = {
    title: 'New client intake',
    description: 'Tell us about yourself before your first appointment.',
    robots: { index: false, follow: false },
}

function FormCard({ href, title, description, cta }) {
    return (
        <li>
            <Link
                href={href}
                className="flex h-full flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-400"
            >
                <span>
                    <span className="block text-lg font-semibold text-slate-900">{title}</span>
                    <span className="mt-1 block text-sm leading-6 text-slate-600">{description}</span>
                </span>
                <span className="text-sm font-semibold text-slate-900">{cta} →</span>
            </Link>
        </li>
    )
}

/**
 * Intake entry point.
 *
 * Which form is shown is a per-domain setting (`splose`, `native`, or `both`), and
 * `?form=` can pick between the forms that setting already allows — a preview link
 * can never switch on a form the practice turned off.
 */
export default async function IntakePage({ searchParams }) {
    const params = await searchParams
    const headerStore = await headers()
    const host = headerStore.get('x-forwarded-host') || headerStore.get('host') || ''

    const domain = resolvePublicIntakeDomain(
        { headers: headerStore },
        params?.domain || detectDomainFromHostname(host) || ''
    )
    const settings = await readIntakeSettings(domain)
    const { form, available } = resolveIntakeChoice(settings.mode, params?.form)

    if (form === 'native') {
        return <NativeIntakeForm domain={domain} form="native" />
    }

    if (available.includes('native')) {
        return (
            <main className="min-h-screen bg-slate-50 px-4 py-16">
                <div className="mx-auto w-full max-w-3xl">
                    <h1 className="text-3xl font-semibold text-slate-900">New client intake</h1>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                        Choose how you would like to complete your intake form.
                    </p>
                    <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                        <FormCard
                            href={`/intake?form=native${domain ? `&domain=${encodeURIComponent(domain)}` : ''}`}
                            title="Fill it in here"
                            description="Answer a short set of questions on this page. Your practice receives it straight away."
                            cta="Start the form"
                        />
                        <FormCard
                            href={`/intake?form=splose${domain ? `&domain=${encodeURIComponent(domain)}` : ''}`}
                            title="Use the guided assistant"
                            description="Our assistant asks each question in turn and completes the practice's standard form for you."
                            cta="Start the assistant"
                        />
                    </ul>
                </div>
            </main>
        )
    }

    return <SploseIntakeChat />
}
