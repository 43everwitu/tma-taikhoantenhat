'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { twoFactor, setAdminToken } from '@/lib/api'

export default function AdminProfilePage() {
  const router = useRouter()
  const sp = useSearchParams()
  const isEnroll = sp.get('enroll') === '1'

  const [state, setState] = useState<{ enabled: boolean; required: boolean; backupCount: number } | null>(null)
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrDataUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmedSaved, setConfirmedSaved] = useState(false)

  async function load() {
    try {
      const r = await twoFactor.state()
      setState(r.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tải trạng thái 2FA lỗi')
    }
  }

  useEffect(() => { load() }, [])

  async function startSetup() {
    setError(''); setBusy(true)
    try {
      const r = await twoFactor.setup()
      setSetup(r.data)
    } catch (e) { setError(e instanceof Error ? e.message : 'Tạo QR lỗi') }
    finally { setBusy(false) }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const r = await twoFactor.enable(code)
      setBackupCodes(r.data.backupCodes)
      setCode('')
      setSetup(null)
      if (r.data.token) setAdminToken(r.data.token)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Mã không đúng') }
    finally { setBusy(false) }
  }

  async function disable() {
    const c = window.prompt('Nhập mã hiện tại để xác nhận tắt 2FA:')
    if (!c) return
    setError(''); setBusy(true)
    try {
      await twoFactor.disable(c)
      setBackupCodes(null)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Tắt 2FA lỗi') }
    finally { setBusy(false) }
  }

  async function regenerate() {
    const c = window.prompt('Nhập mã hiện tại để tạo mã dự phòng mới (mã cũ sẽ hết hiệu lực):')
    if (!c) return
    setError(''); setBusy(true)
    try {
      const r = await twoFactor.regenerate(c)
      setBackupCodes(r.data.backupCodes)
      setConfirmedSaved(false)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Tạo mã dự phòng lỗi') }
    finally { setBusy(false) }
  }

  return (
    <main className="p-4 max-w-2xl">
      <h1 className="clay-display text-2xl mb-1">Hồ sơ admin</h1>
      <p className="text-clay-charcoal mb-6">Bảo mật tài khoản</p>

      {isEnroll && !state?.enabled && (
        <div className="clay-card p-4 mb-4 border-l-4" style={{ borderColor: 'var(--brand-gold)' }}>
          <p className="font-medium">Tài khoản này yêu cầu 2FA</p>
          <p className="text-sm text-clay-charcoal">Hoàn tất cài đặt 2FA bên dưới để vào dashboard.</p>
        </div>
      )}

      <section className="clay-card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-lg">Xác thực 2 yếu tố (TOTP)</h2>
            <p className="text-xs text-clay-charcoal mt-0.5">
              Trạng thái: {state?.enabled ? '✅ Đang bật' : '❌ Chưa bật'}
              {state?.required && ' · Bắt buộc'}
              {state?.enabled && ` · ${state.backupCount} mã dự phòng còn lại`}
            </p>
          </div>
          {state?.enabled ? (
            <div className="flex gap-2">
              <button onClick={regenerate} disabled={busy} className="clay-btn">Tạo mã dự phòng mới</button>
              {!state.required && (
                <button onClick={disable} disabled={busy} className="clay-btn clay-btn--danger">Tắt 2FA</button>
              )}
            </div>
          ) : !setup ? (
            <button onClick={startSetup} disabled={busy} className="clay-btn clay-btn--ink">Bật 2FA</button>
          ) : null}
        </div>

        {setup && (
          <form onSubmit={confirmEnable} className="mt-3 space-y-3">
            <p className="text-sm">Quét mã QR bằng Google Authenticator / Authy / 1Password:</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="QR code" className="block mx-auto" width={240} height={240} />
            <p className="text-xs text-clay-charcoal text-center">
              Hoặc nhập tay: <code className="font-mono bg-clay-cream px-1.5 py-0.5 rounded">{setup.secret}</code>
            </p>
            <label className="block text-sm font-medium">Nhập mã 6 chữ số từ app để xác nhận</label>
            <input
              className="clay-input w-full font-mono text-lg tracking-widest"
              value={code}
              onChange={e => setCode(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              autoFocus
              required
            />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="clay-btn clay-btn--ink">Xác nhận bật</button>
              <button type="button" onClick={() => { setSetup(null); setCode('') }} className="clay-btn">Huỷ</button>
            </div>
          </form>
        )}

        {backupCodes && (
          <div className="mt-4 p-4 rounded-xl border-2 border-amber-400 bg-amber-50">
            <p className="font-bold mb-2">⚠️ Lưu mã dự phòng ngay!</p>
            <p className="text-sm mb-3 text-clay-charcoal">Mỗi mã dùng một lần. Lưu offline (giấy / password manager). Sẽ KHÔNG hiển thị lại.</p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm mb-3">
              {backupCodes.map((c) => <code key={c} className="bg-white px-2 py-1 rounded">{c}</code>)}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirmedSaved} onChange={e => setConfirmedSaved(e.target.checked)} />
              Tôi đã lưu các mã này
            </label>
            <button
              disabled={!confirmedSaved}
              onClick={() => {
                setBackupCodes(null)
                if (isEnroll) router.replace('/admin/dashboard')
              }}
              className="clay-btn clay-btn--ink mt-3 disabled:opacity-50"
            >
              Hoàn tất
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm" style={{ color: 'var(--color-pomegranate-400)' }}>{error}</p>}
      </section>
    </main>
  )
}
