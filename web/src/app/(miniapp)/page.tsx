'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type MouseEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from './components/MiniAppShell'
import { ProductSummary } from './components/ProductCard'
import { ProductRail } from './components/ProductRail'
import { SearchBox } from './components/SearchBox'
import { CategoryStrip } from './components/CategoryStrip'
import { AnnouncementCarousel } from './components/AnnouncementCarousel'
import { Icon } from './components/Icon'
import { DiscountCodeMeta, type DiscountMetaMode } from './components/DiscountCodeMeta'
import { SocialLinksRow } from './components/SocialLinks'
import { getRecentlyViewedIds } from '@/lib/recentlyViewed'
import { getVisibleRenewalNotifications, removeNotificationById } from '@/lib/renewalNotifications'
import { acknowledgeRenewalNotification } from '@/lib/renewalNotificationActions'
import { t } from '@/i18n/vi'

interface Announcement { id: string; title: string; body: string; pinned: boolean; createdAt: string }
interface RenewalNotificationData {
  renewUrl?: string
  orderUrl?: string
  expiryDate?: string
  remainingDays?: number
}
interface CustomerNotification {
  id: number
  type: string
  title: string
  body: string
  data: string | null
  is_read: number
  created_at: string
}
interface Category { id: number; name: string; slug: string; emoji: string }
interface GlobalDiscount {
  code: string
  label: string
  title?: string
  appMetaMode?: DiscountMetaMode
  appMetaText?: string
  appMessage?: string
}
interface HomePayload {
  announcements: Announcement[]
  globalDiscount: GlobalDiscount | null
  categories: Category[]
  featured: ProductSummary[]
  newest: ProductSummary[]
}

export default function MiniAppHome() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [recentIds] = useState<string[]>(() => getRecentlyViewedIds())
  const [q, setQ] = useState('')
  const [copiedGlobalCode, setCopiedGlobalCode] = useState(false)

  const home = useQuery({
    queryKey: ['home'],
    queryFn: () => apiFetch<HomePayload>('/home'),
    staleTime: 60_000,
  })
  const recently = useQuery({
    queryKey: ['products', 'recently', recentIds.join(',')],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?ids=${recentIds.join(',')}`),
    enabled: recentIds.length > 0,
  })
  const notifications = useQuery({
    queryKey: ['notifications', 'renewals'],
    queryFn: async () => {
      try {
        return await apiFetch<CustomerNotification[]>('/notifications/my')
      } catch {
        return []
      }
    },
    staleTime: 60_000,
  })
  const ann = home.data?.announcements ?? []
  const renewalNotifications = getVisibleRenewalNotifications(notifications.data ?? []) as CustomerNotification[]
  const cats = home.data?.categories ?? []
  const featured = home.data?.featured ?? []
  const newest = home.data?.newest ?? []
  const activeGlobalDiscount = home.data?.globalDiscount

  useEffect(() => {
    if (!home.data) return
    queryClient.setQueryData(['announcements'], home.data.announcements)
    queryClient.setQueryData(['discounts', 'global'], home.data.globalDiscount)
    queryClient.setQueryData(['categories', 'noUncat'], home.data.categories)
    queryClient.setQueryData(['products', 'featured'], home.data.featured)
    queryClient.setQueryData(['products', 'newest', 30], home.data.newest)
  }, [home.data, queryClient])

  async function copyGlobalDiscountCode(code: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(code)
      setCopiedGlobalCode(true)
      setTimeout(() => setCopiedGlobalCode(false), 1500)
    } catch {
      // No-op: clipboard can fail on unsupported clients.
    }
  }

  async function handleRenewalNotificationAction(
    item: CustomerNotification,
    url: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) {
    event.preventDefault()
    await acknowledgeRenewalNotification({
      notificationId: item.id,
      url,
      removeFromCache: (notificationId: number) => {
        queryClient.setQueryData<CustomerNotification[]>(['notifications', 'renewals'], (old) =>
          removeNotificationById(old ?? [], notificationId),
        )
      },
      markRead: (notificationId: number) => apiFetch<{ id: number; isRead: boolean }>(
        `/notifications/${notificationId}/read`,
        { method: 'PATCH' },
        { auth: 'required' },
      ),
      navigate: (targetUrl: string) => router.push(targetUrl),
    })
  }

  return (
    <MiniAppShell>
      <section className="miniapp-hero">
        <p className="text-xs uppercase tracking-wider opacity-70 mb-2">{t.appName}</p>
        <h1>Mua hàng tự động</h1>
        <p>Mua trong Mini App Telegram. Giao key tự động - Bảo hành toàn thời hạn.</p>
        <Link href="/san-pham" className="miniapp-hero-cta">
          Khám phá ngay
          <Icon name="arrowRight" size={16} />
        </Link>
      </section>

      {activeGlobalDiscount && (
        <section className="rounded-2xl p-3 mt-3 text-sm" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}>
          <p className="font-semibold leading-snug">
            {activeGlobalDiscount.title || `${activeGlobalDiscount.label} tự động`}
          </p>
          <DiscountCodeMeta
            code={activeGlobalDiscount.code}
            label={activeGlobalDiscount.label}
            mode={activeGlobalDiscount.appMetaMode}
            text={activeGlobalDiscount.appMetaText}
            copied={copiedGlobalCode}
            onCopy={() => copyGlobalDiscountCode(activeGlobalDiscount.code)}
          />
          {activeGlobalDiscount.appMessage && <p className="text-xs opacity-75 mt-1 leading-relaxed">{activeGlobalDiscount.appMessage}</p>}
        </section>
      )}

      <section className="miniapp-section">
        <div className="miniapp-section-title">
          <span>{t.home.categoriesTitle}</span>
        </div>
        {home.isLoading && <p className="opacity-60 text-sm">Đang tải…</p>}
        {!home.isLoading && cats.length === 0 && (
          <p className="opacity-60 text-sm">{t.home.emptyCategories}</p>
        )}
        {cats.length > 0 && (
          <CategoryStrip items={cats} />
        )}
      </section>

      <div className="mb-3 mt-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm sản phẩm…" />
      </div>

      {renewalNotifications.length > 0 && (
        <section className="miniapp-section miniapp-section--compact">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" size={16} />
              Gia hạn
            </span>
          </div>
          <div className="space-y-2">
            {renewalNotifications.map((item) => (
              <RenewalNotificationCard key={item.id} item={item} onAction={handleRenewalNotificationAction} />
            ))}
          </div>
        </section>
      )}

      {ann.length > 0 && (
        <section className="miniapp-section miniapp-section--compact miniapp-home-notifications">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="megaphone" size={16} />
              {t.home.announcementsTitle}
            </span>
          </div>
          <AnnouncementCarousel items={ann} />
        </section>
      )}

      {recently.data && recently.data.length > 0 && (
        <section className="miniapp-section miniapp-section--compact miniapp-home-recent">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" size={16} />
              Sản phẩm đã xem
            </span>
          </div>
          <ProductRail items={recently.data} />
        </section>
      )}

      {featured.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={16} />
              Sản phẩm nổi bật
            </span>
            <Link href="/san-pham" className="inline-flex items-center gap-1">
              Tất cả <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <ProductRail items={featured} eagerFirst />
        </section>
      )}

      {newest.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={16} />
              Sản phẩm mới
            </span>
            <Link href="/san-pham" className="inline-flex items-center gap-1">
              Tất cả <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <ProductRail items={newest} />
        </section>
      )}

      <SocialLinksRow />
    </MiniAppShell>
  )
}

function parseNotificationData(raw: string | null): RenewalNotificationData {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as RenewalNotificationData
  } catch {
    return {}
  }
}

function RenewalNotificationCard({
  item,
  onAction,
}: {
  item: CustomerNotification
  onAction: (item: CustomerNotification, url: string, event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const data = parseNotificationData(item.data)
  return (
    <article className="rounded-2xl p-3.5" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)', border: '1px solid color-mix(in srgb, var(--brand-gold-deep) 25%, transparent)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold leading-snug">{item.title}</p>
          <p className="text-xs opacity-75 mt-1 leading-relaxed">{item.body}</p>
        </div>
        {typeof data.remainingDays === 'number' && (
          <span className="miniapp-status miniapp-status--key-soon whitespace-nowrap">
            Còn {Math.max(0, data.remainingDays)} ngày
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {data.renewUrl && (
          <Link
            href={data.renewUrl}
            className="miniapp-btn miniapp-btn--ink justify-center text-sm"
            onClick={(event) => onAction(item, data.renewUrl!, event)}
          >
            Gia hạn ngay
          </Link>
        )}
        {data.orderUrl && (
          <Link
            href={data.orderUrl}
            className="miniapp-btn miniapp-btn--ghost justify-center text-sm"
            onClick={(event) => onAction(item, data.orderUrl!, event)}
          >
            Xem đơn
          </Link>
        )}
      </div>
    </article>
  )
}
