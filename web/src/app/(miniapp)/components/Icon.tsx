import { miniappIcons, type MiniappIconName } from '@/lib/miniappIcons'

type Props = {
  name: MiniappIconName
  size?: number
  strokeWidth?: number
  className?: string
  'aria-hidden'?: boolean
}

export function Icon({ name, size = 20, strokeWidth = 1.75, className, ...rest }: Props) {
  const Cmp = miniappIcons[name]
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} aria-hidden {...rest} />
}
