'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'

// The app-wide explainer affordance: a small ⓘ trigger with a styled hover/focus panel.
//
// Native `title` tooltips cannot be styled, wrap badly on long copy and are invisible to touch and
// keyboard users, so explanatory text uses this component instead. `text` may be a string or a node
// (a stamp/tag inside the copy needs markup). Two shapes:
//   * trigger omitted  -> the standard round ⓘ button, for use beside a heading
//   * children given   -> the child content becomes the trigger (e.g. a status pill), so a chip can
//                         carry its own explainer without gaining a second control
//
// Behaviour is deliberately the same in both shapes: hover opens, moving onto the panel keeps it
// open (the panel is inside the hover container), focus opens for keyboard users, and a press
// anywhere else or Escape dismisses it.

const DEFAULT_TRIGGER_CLASS = 'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-sky-300'

const PANEL_PLACEMENT_CLASS = {
    bottom: 'top-full mt-2',
    top: 'bottom-full mb-2',
}

const PANEL_ALIGN_CLASS = {
    left: 'left-0',
    right: 'right-0',
}

export default function InfoTooltip({
    text,
    label = 'More information',
    children = null,
    placement = 'bottom',
    align = 'left',
    widthClassName = 'w-64',
    triggerClassName = '',
    panelClassName = '',
    className = '',
}) {
    const [open, setOpen] = useState(false)
    const containerRef = useRef(null)
    const panelId = useId()
    const hasCustomTrigger = children !== null && children !== undefined

    useEffect(() => {
        if (!open || typeof window === 'undefined') return

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false)
        }
        // Tapping the trigger open has no hover to fall back on, so a press anywhere else
        // dismisses it (the same outside-click guard shape the tab strip's "+ Add" menu uses).
        const handlePointerDown = (event) => {
            if (!containerRef.current?.contains(event.target)) setOpen(false)
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('pointerdown', handlePointerDown, true)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('pointerdown', handlePointerDown, true)
        }
    }, [open])

    if (!text) return null

    return (
        <span
            ref={containerRef}
            className={`relative flex items-center ${className}`}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <button
                type="button"
                onClick={() => setOpen(true)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                aria-label={label}
                aria-describedby={open ? panelId : undefined}
                aria-expanded={open}
                className={hasCustomTrigger
                    ? `cursor-help ${triggerClassName}`
                    : `${DEFAULT_TRIGGER_CLASS} ${triggerClassName}`}
            >
                <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
                {children}
            </button>
            {open && (
                <span
                    id={panelId}
                    role="tooltip"
                    className={`absolute z-20 rounded-md border border-gray-200 bg-white p-3 text-xs font-normal leading-relaxed text-gray-600 shadow-lg ${widthClassName} ${PANEL_PLACEMENT_CLASS[placement] || PANEL_PLACEMENT_CLASS.bottom} ${PANEL_ALIGN_CLASS[align] || PANEL_ALIGN_CLASS.left} ${panelClassName}`}
                >
                    {text}
                </span>
            )}
        </span>
    )
}
