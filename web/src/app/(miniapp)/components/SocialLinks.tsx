'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { Icon } from './Icon'
import { BrandIcon, type BrandPlatform } from './BrandIcons'

interface ShopInfo {
  supportUrl?: string
  socialTelegram?: string
  socialZalo?: string
  socialFacebook?: string
}

interface Contact {
  key: string
  label: string
  platform: BrandPlatform | 'support'
  url: string
}

function useShopInfo() {
  return useQuery({
    queryKey: ['shop', 'info'],
    queryFn: () => apiFetch<ShopInfo>('/shop/info'),
    staleTime: 5 * 60_000,
  })
}

function useContacts(): Contact[] {
  const shopInfo = useShopInfo()
  const data = shopInfo.data
  const contacts: Contact[] = []
  const seenUrls = new Set<string>()

  function add(contact: Contact) {
    if (seenUrls.has(contact.url)) return
    seenUrls.add(contact.url)
    contacts.push(contact)
  }

  if (data?.socialTelegram?.trim()) add({ key: 'telegram', label: 'Telegram', platform: 'telegram', url: data.socialTelegram.trim() })
  if (data?.socialZalo?.trim()) add({ key: 'zalo', label: 'Zalo', platform: 'zalo', url: data.socialZalo.trim() })
  if (data?.socialFacebook?.trim()) add({ key: 'facebook', label: 'Facebook', platform: 'facebook', url: data.socialFacebook.trim() })
  // support_url often duplicates one of the socials above (e.g. same Telegram
  // link) — only add it as its own "Hỗ trợ" entry when it points somewhere else.
  if (data?.supportUrl?.trim()) add({ key: 'support', label: 'Hỗ trợ', platform: 'support', url: data.supportUrl.trim() })

  return contacts
}

function ContactIcon({ platform, size }: { platform: Contact['platform']; size: number }) {
  if (platform === 'support') {
    return (
      <span
        className="inline-flex items-center justify-center rounded-md"
        style={{ width: size, height: size, background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}
      >
        <Icon name="support" size={size - 6} />
      </span>
    )
  }
  return <BrandIcon platform={platform} size={size} />
}

// Support button in the nav: single contact → direct anchor (old behavior).
// Multiple contacts configured → popover listing each with its own brand icon.
export function ContactButton({ variant }: { variant: 'desktop' | 'mobile' }) {
  const contacts = useContacts()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (contacts.length === 0) return null

  if (contacts.length === 1) {
    const only = contacts[0]
    return variant === 'desktop' ? (
      <a href={only.url} target="_blank" rel="noopener noreferrer" className="miniapp-topnav-link">
        <ContactIcon platform={only.platform} size={18} />
        {only.label}
      </a>
    ) : (
      <a
        href={only.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={only.label}
        className="inline-flex items-center justify-center w-9 h-9 rounded-full"
        style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}
      >
        <ContactIcon platform={only.platform} size={18} />
      </a>
    )
  }

  return (
    <div ref={wrapRef} className="relative">
      {variant === 'desktop' ? (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="miniapp-topnav-link">
          <Icon name="support" size={18} />
          Hỗ trợ
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Hỗ trợ"
          className="inline-flex items-center justify-center w-9 h-9 rounded-full"
          style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}
        >
          <Icon name="support" size={18} />
        </button>
      )}

      {open && (
        <div className="miniapp-filter-panel" role="dialog" aria-label="Liên hệ" style={{ minWidth: 190, gap: '.25rem' }}>
          {contacts.map((c) => (
            <a
              key={c.key}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="miniapp-topnav-link"
              onClick={() => setOpen(false)}
            >
              <ContactIcon platform={c.platform} size={22} />
              {c.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// Icon rail shown at the bottom of catalog-style pages (home, listing, detail)
// — sourced from the same settings as the nav contact button.
export function SocialLinksRow() {
  const contacts = useContacts()
  if (contacts.length === 0) return null

  return (
    <section className="miniapp-section miniapp-section--compact">
      <div className="miniapp-section-title">
        <span>Kết nối với chúng tôi</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {contacts.map((c) => (
          <a
            key={c.key}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="miniapp-filterbar-btn"
          >
            <ContactIcon platform={c.platform} size={18} />
            <span>{c.label}</span>
          </a>
        ))}
      </div>
    </section>
  )
}
