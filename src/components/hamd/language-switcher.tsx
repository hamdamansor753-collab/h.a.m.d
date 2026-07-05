'use client'

/**
 * Language switcher — purely client-side. Updates the I18nProvider's
 * locale by fetching the new dictionary from /api/i18n/dictionary.
 * (Phase 0: does not persist to the user record.)
 */
import { useI18n } from '@/core/i18n/client'
import { LOCALES, LOCALE_LIST, type Locale } from '@/core/i18n/locales'
import { Button } from '@/components/ui/button'
import { Languages } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Props {
  locale: Locale
  onChange: (l: Locale) => void
}

export function LanguageSwitcher({ locale, onChange }: Props) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Languages className="h-4 w-4" />
          <span className="text-sm">{LOCALES[locale].displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2 py-1 text-xs text-muted-foreground">{t('common.language')}</div>
        {LOCALE_LIST.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => onChange(l)}
            className={l === locale ? 'bg-accent text-accent-foreground' : ''}
          >
            {LOCALES[l].displayName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
