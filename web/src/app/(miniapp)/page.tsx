'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from './components/MiniAppShell'
import { t } from '@/i18n/vi'

interface Announcement { id: string; title: string; body: string; pinned: boolean }
interface Category { id: number; name: string; slug: string; emoji: string }

export default function MiniAppHome() {
  const ann = useQuery({
    queryKey: ['announcements'],
    queryFn: () => apiFetch<Announcement[]>('/announcements'),
  })
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  })

  return (
    <MiniAppShell title={t.appName}>
      {ann.data && ann.data.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold mb-2 opacity-70">{t.home.announcementsTitle}</h2>
          <ul className="space-y-2">
            {ann.data.slice(0, 3).map((a) => (
              <li key={a.id} className="rounded-lg p-3" style={{ background: 'var(--tg-bg-2)' }}>
                <p className="font-medium">{a.title}</p>
                <p className="text-sm opacity-80 whitespace-pre-line">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2 opacity-70">{t.home.categoriesTitle}</h2>
        {cats.isLoading && <p className="opacity-60">…</p>}
        {cats.data && cats.data.length === 0 && <p className="opacity-60">{t.home.emptyCategories}</p>}
        {cats.data && cats.data.length > 0 && (
          <ul className="grid grid-cols-2 gap-3">
            {cats.data.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/danh-muc/${c.slug}`}
                  className="block rounded-xl p-4 text-center"
                  style={{ background: 'var(--tg-bg-2)' }}
                >
                  <div className="text-3xl">{c.emoji || '📦'}</div>
                  <div className="mt-2 text-sm font-medium">{c.name}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </MiniAppShell>
  )
}
