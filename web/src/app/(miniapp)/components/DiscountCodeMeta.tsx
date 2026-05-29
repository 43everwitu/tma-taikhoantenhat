'use client'

import { Icon } from './Icon'

export type DiscountMetaMode = 'auto' | 'custom' | 'hidden'

interface Props {
  code: string
  label?: string
  mode?: DiscountMetaMode
  text?: string
  copied?: boolean
  onCopy: () => void
}

export function DiscountCodeMeta({ code, label, mode = 'auto', text, copied = false, onCopy }: Props) {
  if (mode === 'hidden') return null

  const meta = mode === 'custom' ? text : label

  return (
    <p className="miniapp-discount-meta">
      <button
        type="button"
        onClick={onCopy}
        className="miniapp-discount-code-chip"
        aria-label={copied ? 'Đã sao chép mã' : 'Sao chép mã giảm giá'}
      >
        <code>{code}</code>
        <Icon name={copied ? 'check' : 'copy'} size={12} />
      </button>
      {meta && <span className="miniapp-discount-meta-text">· {meta}</span>}
    </p>
  )
}
