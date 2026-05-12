import { Icon } from './Icon'
import type { MiniappIconName } from '@/lib/miniappIcons'

type Status = 'pending' | 'paid' | 'delivered' | 'cancelled' | 'expired'

const statusIcon: Record<Status, MiniappIconName> = {
  pending:   'clock',
  paid:      'check',
  delivered: 'check',
  cancelled: 'cross',
  expired:   'alert',
}

const statusLabel: Record<Status, string> = {
  pending:   'Chờ thanh toán',
  paid:      'Đã thanh toán',
  delivered: 'Đã giao',
  cancelled: 'Đã huỷ',
  expired:   'Đã hết hạn',
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`miniapp-status miniapp-status--${status}`}>
      <Icon name={statusIcon[status]} size={14} />
      {statusLabel[status]}
    </span>
  )
}
