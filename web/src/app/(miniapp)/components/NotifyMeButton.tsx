'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { useToast } from '@/components/Toast'
import { Icon } from './Icon'
import { t } from '@/i18n/vi'

interface Props {
  productId: string
  variantId: string
}

// "Thông báo khi có hàng" for a sold-out variant. The bot messages the customer
// once the variant is restocked; state lives server-side per (user, variant).
export function NotifyMeButton({ productId, variantId }: Props) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const queryKey = ['notify-me', productId]

  // Outside Telegram there is no session — the query just errors and the
  // button behaves as "not subscribed"; clicking explains how to sign in.
  const { data } = useQuery({
    queryKey,
    queryFn: () => apiFetch<{ variantIds: string[] }>(`/products/${productId}/notify-me`, {}, { auth: 'required' }),
    retry: false,
  })
  const subscribed = !!data?.variantIds.includes(variantId)

  async function toggle() {
    setBusy(true)
    try {
      await apiFetch(`/variants/${variantId}/notify-me`, { method: subscribed ? 'DELETE' : 'POST' }, { auth: 'required' })
      qc.setQueryData<{ variantIds: string[] }>(queryKey, (prev) => {
        const ids = (prev?.variantIds ?? []).filter((id) => id !== variantId)
        return { variantIds: subscribed ? ids : [...ids, variantId] }
      })
      toast.success(subscribed ? t.product.notifyMeCancelled : t.product.notifyMeDone)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.product.notifyMeFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`miniapp-btn ${subscribed ? 'miniapp-btn--ghost' : 'miniapp-btn--primary'} justify-center`}
    >
      <Icon name="bell" size={18} /> {subscribed ? t.product.notifyMeOn : t.product.notifyMe}
    </button>
  )
}
