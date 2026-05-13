import {
  Home, ShoppingCart, ClipboardList, Search, Package, Megaphone, Sparkles,
  BookOpen, Film, Wrench, Zap, Plus, Minus, Trash2, Inbox, Clock, CheckCircle2,
  XCircle, AlertCircle, Copy, ArrowRight, ChevronRight, Menu, X, SlidersHorizontal,
  MessageCircle, Headphones,
  type LucideIcon,
} from 'lucide-react'

export const miniappIcons = {
  home: Home,
  cart: ShoppingCart,
  orders: ClipboardList,
  search: Search,
  package: Package,
  megaphone: Megaphone,
  sparkles: Sparkles,
  bookOpen: BookOpen,
  film: Film,
  wrench: Wrench,
  zap: Zap,
  plus: Plus,
  minus: Minus,
  trash: Trash2,
  inbox: Inbox,
  clock: Clock,
  check: CheckCircle2,
  cross: XCircle,
  alert: AlertCircle,
  copy: Copy,
  arrowRight: ArrowRight,
  chevronRight: ChevronRight,
  menu: Menu,
  close: X,
  filter: SlidersHorizontal,
  support: MessageCircle,
  headphones: Headphones,
} satisfies Record<string, LucideIcon>

export type MiniappIconName = keyof typeof miniappIcons

// Slug → category icon. Add new categories here as the catalog grows.
export const categoryIcons: Record<string, MiniappIconName> = {
  'hoc-tap': 'bookOpen',
  'giai-tri': 'film',
  'tien-ich': 'wrench',
  'uncategorized': 'package',
}
