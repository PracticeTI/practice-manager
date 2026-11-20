export const metadata = {
    title: 'Admin Login',
    description: 'Admin authentication portal',
    robots: {
        index: false,
        follow: false,
        nocache: true,
        googleBot: {
            index: false,
            follow: false,
            noimageindex: true,
        },
    },
}

export default function LoginLayout({ children }) {
    return children
}
