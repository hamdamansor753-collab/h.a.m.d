'use client'

/**
 * Local icon re-exports for the few lucide icons that don't exist by the
 * names we want. We use lucide-react directly elsewhere; this file only
 * exists to provide `ChevronEnd` (pointing toward the inline-end, which
 * in RTL is the LEFT and in LTR is the RIGHT) — lucide doesn't ship a
 * direction-agnostic end chevron, so we pick `ChevronRight` and rely on
 * the `dir` attribute on the parent to flip it visually via CSS.
 */
import { ChevronRight, ChevronDown } from 'lucide-react'

export const ChevronEnd = ChevronRight
export { ChevronDown }
