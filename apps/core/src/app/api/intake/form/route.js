import { NextResponse } from 'next/server'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import {
    intakeFormsForMode,
    normalizeIntakeSettings,
    resolveIntakeChoice,
} from '@/lib/nativeIntake'
import { readIntakeSettings, readNativeIntakeForm, resolvePublicIntakeDomain } from '@/lib/nativeIntakeStore'

/**
 * GET /api/intake/form
 *
 * Public definition of the native intake form for a domain. Returns the mode and
 * the forms the mode offers so the page can render the right thing; the
 * definition itself is only sent when the native form is actually reachable.
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url)
        const domain = resolvePublicIntakeDomain(request, searchParams.get('domain'))
        const settings = await readIntakeSettings(domain)
        const { form, available } = resolveIntakeChoice(settings.mode, searchParams.get('form'))
        const practiceName = await readDomainPracticeName(domain).catch(() => '')

        if (!available.includes('native')) {
            return NextResponse.json({
                success: true,
                data: {
                    domain,
                    mode: settings.mode,
                    available,
                    form: 'splose',
                    native_available: false,
                },
            })
        }

        const definition = await readNativeIntakeForm(domain)

        return NextResponse.json({
            success: true,
            data: {
                domain,
                mode: settings.mode,
                available,
                form,
                native_available: true,
                practice: { name: practiceName || domain },
                settings: normalizeIntakeSettings(settings),
                definition,
                forms: intakeFormsForMode(settings.mode),
            },
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load the intake form' },
            { status: 500 }
        )
    }
}
