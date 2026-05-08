'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type FieldType = 'text' | 'number' | 'bool' | 'url' | 'textarea'

interface FieldMeta {
  key: string
  label: string
  type: FieldType
  description: string
  placeholder?: string
  unit?: string
}

interface Group {
  title: string
  emoji: string
  blurb?: string
  fields: FieldMeta[]
}

// Source-of-truth UI metadata. Order within a group = display order.
// Keys not listed here fall through to a generic "Khác" group at the bottom.
const GROUPS: Group[] = [
  {
    title: 'Thông tin shop',
    emoji: '🏪',
    blurb: 'Hiển thị trên Telegram, tin nhắn chào, và lệnh /support.',
    fields: [
      { key: 'shop_name', label: 'Tên shop', type: 'text',
        description: 'Tên hiển thị trong tin nhắn chào và menu của bot.',
        placeholder: 'Auto-chan' },
      { key: 'support_contact', label: 'Liên hệ hỗ trợ', type: 'text',
        description: 'Username hoặc link Telegram (vd: @peanut1010). Hiển thị khi user gõ /support.',
        placeholder: '@peanut1010' },
      { key: 'website_url', label: 'URL website', type: 'url',
        description: 'Link gửi qua lệnh /website. Phải bắt đầu bằng http:// hoặc https://.',
        placeholder: 'https://peanut.shop' },
      { key: 'website_description', label: 'Mô tả website', type: 'textarea',
        description: 'Một câu mô tả ngắn hiển thị trong /website.',
        placeholder: 'Cửa hàng tài khoản số chính hãng' },
    ],
  },
  {
    title: 'Thanh toán & đơn hàng',
    emoji: '💳',
    blurb: 'Cấu hình thời gian chờ, polling MB Bank, và phí.',
    fields: [
      { key: 'auto_payment_enabled', label: 'Tự động dò giao dịch MB Bank', type: 'bool',
        description: 'Bật để bot tự match chuyển khoản với mã PNS<id> và giao hàng tự động. Tắt thì admin phải duyệt mọi đơn thủ công.' },
      { key: 'order_expiry_minutes', label: 'Hạn thanh toán đơn', type: 'number', unit: 'phút',
        description: 'Đơn pending quá thời gian này → tự huỷ. QR cũng hết hạn theo. Khuyến nghị 10–15 phút.' },
      { key: 'payment_timeout_minutes', label: 'Timeout payment (legacy)', type: 'number', unit: 'phút',
        description: 'Cũ — giữ tương thích. Dùng order_expiry_minutes thay thế.' },
      { key: 'payment_poll_interval_seconds', label: 'Tần suất dò MB Bank', type: 'number', unit: 'giây',
        description: 'Bot poll MB Bank mỗi N giây khi có đơn pending. Thấp = phản hồi nhanh nhưng nhiều API call. Khuyến nghị 15–30s.' },
    ],
  },
  {
    title: 'Nạp ví',
    emoji: '💼',
    blurb: 'Quy định lệnh /nap và yêu cầu nạp.',
    fields: [
      { key: 'topup_min_amount', label: 'Số tiền nạp tối thiểu', type: 'number', unit: 'đ',
        description: 'Bot từ chối /nap dưới mức này. Tránh khách nạp vài nghìn gây lãng phí giao dịch.' },
      { key: 'topup_expiry_minutes', label: 'Hạn yêu cầu nạp', type: 'number', unit: 'phút',
        description: 'QR nạp ví hết hạn sau khoảng này. Khuyến nghị 30 phút (lâu hơn order vì user có thể nạp ngoài giờ rảnh).' },
    ],
  },
  {
    title: 'Tồn kho',
    emoji: '📦',
    blurb: 'Cảnh báo sắp hết hàng.',
    fields: [
      { key: 'low_stock_alert_threshold', label: 'Ngưỡng cảnh báo tồn kho mặc định', type: 'number',
        description: 'Áp dụng cho sản phẩm chưa set ngưỡng riêng. Khi stock ≤ ngưỡng → admin được báo (1 lần / 24h).' },
    ],
  },
  {
    title: 'Thông báo Admin',
    emoji: '🔔',
    blurb: 'Bật/tắt từng loại sự kiện gửi vào DM admin. Sự kiện tắt — nếu có BOT_NOISE_CHAT_ID env var — sẽ chuyển vào channel ghi nhật ký thay vì mất hẳn.',
    fields: [
      { key: 'notify_admin_new_order', label: 'Đơn hàng mới', type: 'bool',
        description: 'Mỗi khi khách tạo đơn (chưa thanh toán). Có thể ồn nếu shop bận — tắt mặc định.' },
      { key: 'notify_admin_payment_short', label: 'Thanh toán thiếu / không khớp', type: 'bool',
        description: 'Bao gồm cả nạp ngoài /nap và CK cho đơn đã hết hạn. Cần để xử lý thủ công.' },
      { key: 'notify_admin_no_stock', label: 'Đã thanh toán nhưng hết hàng', type: 'bool',
        description: 'Race condition: khách trả tiền xong mới phát hiện hết stock → cần giao thủ công gấp.' },
      { key: 'notify_admin_delivered', label: 'Giao hàng tự động thành công', type: 'bool',
        description: 'Mặc định bật. Tắt nếu không cần biết mọi đơn nhỏ.' },
      { key: 'notify_admin_low_stock', label: 'Tồn kho thấp', type: 'bool',
        description: 'Throttled 1 lần / 24h cho mỗi sản phẩm. An toàn để bật.' },
    ],
  },
]

const KNOWN_KEYS = new Set(GROUPS.flatMap(g => g.fields.map(f => f.key)))

interface Settings { [key: string]: string | number | boolean }

function isTruthy(v: string | number | boolean | undefined): boolean {
  return v === true || v === 'true' || v === '1' || v === 1
}

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<Settings>({})
  const [hasChanges, setHasChanges] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<Settings>('/admin/settings'),
  })

  useEffect(() => {
    if (data?.data) {
      setFormData(data.data)
      setHasChanges(false)
    }
  }, [data])

  const saveMutation = useMutation({
    mutationFn: (settings: Settings) => api.put('/admin/settings', settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
      setHasChanges(false)
    },
  })

  function setField(key: string, value: string | boolean) {
    setFormData(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    // Normalize: booleans → 'true'/'false', numbers → digit-string.
    // Keep strings as-is.
    const out: Settings = {}
    for (const [k, v] of Object.entries(formData)) {
      if (typeof v === 'boolean') out[k] = v ? 'true' : 'false'
      else out[k] = String(v)
    }
    saveMutation.mutate(out)
  }

  const unknownKeys = Object.keys(formData).filter(k => !KNOWN_KEYS.has(k)).sort()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="clay-display text-3xl">Cài đặt</h1>
          <p className="text-clay-charcoal text-sm mt-1">
            Mọi thay đổi áp dụng ngay sau khi nhấn Lưu — không cần restart bot.
          </p>
        </div>
        {hasChanges && (
          <span className="clay-pill" style={{ background: 'var(--color-lemon-100)', color: 'var(--color-lemon-700)' }}>
            ● Có thay đổi chưa lưu
          </span>
        )}
      </div>

      {isLoading && (
        <div className="clay-card p-8 text-center text-clay-silver">Đang tải...</div>
      )}

      {!isLoading && (
        <form onSubmit={handleSave} className="space-y-6">
          {GROUPS.map(group => {
            const presentFields = group.fields.filter(f => f.key in formData)
            if (presentFields.length === 0) return null
            return (
              <section key={group.title} className="clay-card p-6">
                <header className="mb-5 pb-4 border-b border-clay-oat-light">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <span aria-hidden>{group.emoji}</span>{group.title}
                  </h2>
                  {group.blurb && (
                    <p className="text-sm text-clay-charcoal mt-1">{group.blurb}</p>
                  )}
                </header>

                <div className="space-y-5">
                  {presentFields.map(field => (
                    <FieldRow
                      key={field.key}
                      meta={field}
                      value={formData[field.key]}
                      original={data?.data?.[field.key]}
                      onChange={(v) => setField(field.key, v)}
                    />
                  ))}
                </div>
              </section>
            )
          })}

          {unknownKeys.length > 0 && (
            <section className="clay-card p-6">
              <header className="mb-5 pb-4 border-b border-clay-oat-light">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <span aria-hidden>🔧</span>Khác
                </h2>
                <p className="text-sm text-clay-charcoal mt-1">
                  Các setting chưa có giao diện riêng — chỉnh thô bằng text.
                </p>
              </header>
              <div className="space-y-4">
                {unknownKeys.map(key => (
                  <div key={key} className="flex items-center gap-3">
                    <code className="font-mono text-sm w-64 flex-shrink-0">{key}</code>
                    <input
                      type="text"
                      value={String(formData[key] ?? '')}
                      onChange={(e) => setField(key, e.target.value)}
                      className="clay-input flex-1 text-sm font-mono"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="sticky bottom-0 z-10 bg-clay-cream/95 backdrop-blur border-t border-clay-oat -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between flex-wrap gap-3">
            {saveMutation.isError && (
              <p className="text-sm" style={{ color: 'var(--color-pomegranate-700)' }}>
                Lỗi: {saveMutation.error instanceof Error ? saveMutation.error.message : 'Lưu thất bại'}
              </p>
            )}
            {saveMutation.isSuccess && !hasChanges && (
              <p className="text-sm" style={{ color: 'var(--color-matcha-600)' }}>✅ Đã lưu</p>
            )}
            <div className="ml-auto flex gap-3">
              {hasChanges && (
                <button
                  type="button"
                  onClick={() => { if (data?.data) setFormData(data.data); setHasChanges(false) }}
                  className="clay-btn text-sm"
                >
                  Hoàn tác
                </button>
              )}
              <button
                type="submit"
                disabled={saveMutation.isPending || !hasChanges}
                className="clay-btn clay-btn--ink text-sm disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Đang lưu...' : 'Lưu cài đặt'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

function FieldRow({
  meta,
  value,
  original,
  onChange,
}: {
  meta: FieldMeta
  value: string | number | boolean | undefined
  original: string | number | boolean | undefined
  onChange: (v: string | boolean) => void
}) {
  const changed = String(value ?? '') !== String(original ?? '')

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_minmax(280px,400px)] gap-4 items-start">
      <div className="min-w-0">
        <label htmlFor={`set-${meta.key}`} className="font-medium text-sm flex items-center gap-2 flex-wrap">
          {meta.label}
          {changed && (
            <span className="clay-pill text-[10px] py-0 px-1.5" style={{ background: 'var(--color-lemon-100)', color: 'var(--color-lemon-700)' }}>
              chưa lưu
            </span>
          )}
        </label>
        <p className="text-xs text-clay-charcoal mt-1 leading-relaxed">{meta.description}</p>
        <code className="font-mono text-[11px] text-clay-silver mt-1 block">{meta.key}</code>
      </div>

      <div>
        {meta.type === 'bool' ? (
          <label className="inline-flex items-center gap-3 cursor-pointer select-none">
            <button
              type="button"
              onClick={() => onChange(!isTruthy(value))}
              className="relative inline-flex h-7 w-12 items-center rounded-full border border-clay-oat transition"
              style={{ background: isTruthy(value) ? 'var(--color-matcha-600)' : 'var(--color-clay-oat)' }}
              aria-pressed={isTruthy(value)}
              aria-label={meta.label}
            >
              <span
                className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
                style={{ transform: isTruthy(value) ? 'translateX(22px)' : 'translateX(2px)' }}
              />
            </button>
            <span className="text-sm font-medium">{isTruthy(value) ? 'Bật' : 'Tắt'}</span>
          </label>
        ) : meta.type === 'textarea' ? (
          <textarea
            id={`set-${meta.key}`}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={meta.placeholder}
            rows={3}
            className="clay-input w-full text-sm resize-y"
          />
        ) : meta.type === 'number' ? (
          <div className="relative">
            <input
              id={`set-${meta.key}`}
              type="number"
              value={String(value ?? '')}
              onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))}
              placeholder={meta.placeholder}
              className={`clay-input w-full text-sm font-mono ${meta.unit ? 'pr-12' : ''}`}
              inputMode="numeric"
            />
            {meta.unit && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-clay-silver pointer-events-none">
                {meta.unit}
              </span>
            )}
          </div>
        ) : (
          <input
            id={`set-${meta.key}`}
            type={meta.type === 'url' ? 'url' : 'text'}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={meta.placeholder}
            className="clay-input w-full text-sm"
          />
        )}
      </div>
    </div>
  )
}
