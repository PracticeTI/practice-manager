import { redirect } from 'next/navigation'

// Legacy route: the Open Graph preview page now lives at /presence and also
// covers favicon and manifest output.
export default function OgRedirectPage() {
    redirect('/presence')
}
