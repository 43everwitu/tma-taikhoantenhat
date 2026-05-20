# TMA Safe-Area Fix — Design

**Date:** 2026-05-20
**Scope:** Mini App shell top/bottom safe-area handling on iOS devices with notch and on Telegram clients that report content safe-area insets (Bot API 8.0+).

## Problem

On iPhone with notch / Dynamic Island, the Mini App's sticky header (`.miniapp-header` in `web/src/app/globals.css`) renders **behind** both the iOS notch and Telegram's own chrome bar (Close button + chevron/dots). Brand mark, title, and top-row icons are partially occluded in half-screen TMA state. Bottom-nav safe-area was handled (`padding-bottom: env(safe-area-inset-bottom)`); the symmetric top fix was never added.

## Goals

- Header sits below iOS notch on all iPhone clients.
- Header sits below Telegram chrome on clients reporting `contentSafeAreaInset` (Bot API 8.0+).
- No regression on Android, on pre-8.0 clients, or in non-TMA web preview.
- Bottom-nav padding also picks up TMA `contentSafeAreaInset.bottom` when reported.
- Side insets respected for landscape edge cases.

## Non-goals

- No change to TMA theming (`applyThemeVars`) or auth flow.
- No move to TMA SDK package — keep the manual `window.Telegram.WebApp` typing.
- No change to admin route (`/admin/*`), which is non-TMA.

## Approach (Hybrid env + TMA insets)

Combine CSS `env(safe-area-inset-*)` (iOS WebView gives notch, always available) with TMA-reported `contentSafeAreaInset` / `safeAreaInset` (Bot API 8.0+ only) written into CSS custom properties. CSS uses `max(env(...), var(--tma-safe-*))` so whichever value is larger wins; older clients fall through to env-only.

## JS Layer — `web/src/lib/telegram.ts`

Extend `TelegramWebApp` interface:

```ts
interface SafeAreaInset { top: number; bottom: number; left: number; right: number }

export interface TelegramWebApp {
  // ...existing fields...
  contentSafeAreaInset?: SafeAreaInset   // Bot API 8.0+
  safeAreaInset?: SafeAreaInset          // Bot API 8.0+
  isExpanded?: boolean
  onEvent?: (event: string, cb: () => void) => void
  offEvent?: (event: string, cb: () => void) => void
  disableVerticalSwipes?: () => void     // Bot API 7.7+
}
```

Add new exported hook (separate from existing `useWebApp` to keep theme path untouched):

```ts
function writeInsets(wa: TelegramWebApp) {
  const ci = wa.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const sa = wa.safeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const r = document.documentElement.style
  r.setProperty('--tma-safe-top',    `${Math.max(ci.top,    sa.top)}px`)
  r.setProperty('--tma-safe-bottom', `${Math.max(ci.bottom, sa.bottom)}px`)
  r.setProperty('--tma-safe-left',   `${Math.max(ci.left,   sa.left)}px`)
  r.setProperty('--tma-safe-right',  `${Math.max(ci.right,  sa.right)}px`)
}

export function useTmaViewport() {
  useEffect(() => {
    const wa = getWebApp()
    if (!wa) return
    wa.ready()
    wa.expand()
    wa.disableVerticalSwipes?.()
    writeInsets(wa)
    const onChange = () => writeInsets(wa)
    wa.onEvent?.('safeAreaChanged', onChange)
    wa.onEvent?.('contentSafeAreaChanged', onChange)
    return () => {
      wa.offEvent?.('safeAreaChanged', onChange)
      wa.offEvent?.('contentSafeAreaChanged', onChange)
    }
  }, [])
}
```

Notes:
- `disableVerticalSwipes` guarded with optional chaining — silently no-op on pre-7.7 clients.
- Cleanup unregisters both event listeners on unmount; hook is mounted once at shell.
- Hook returns nothing — pure side-effect on `:root` CSS vars.

## CSS Layer — `web/src/app/globals.css`

Replace three rules in the `.miniapp-*` block (around line 233+).

```css
.miniapp-root {
  background: var(--tg-bg, var(--brand-cream));
  color: var(--tg-text, var(--brand-ink));
  min-height: 100dvh;
  padding-left:  max(env(safe-area-inset-left,  0px), var(--tma-safe-left,  0px));
  padding-right: max(env(safe-area-inset-right, 0px), var(--tma-safe-right, 0px));
}

.miniapp-header {
  position: sticky; top: 0; z-index: 20;
  backdrop-filter: blur(14px);
  background: color-mix(in srgb, var(--tg-bg, var(--brand-cream)) 88%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent);
  padding-top: max(env(safe-area-inset-top, 0px), var(--tma-safe-top, 0px));
}

.miniapp-bottomnav {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 30;
  display: grid; grid-template-columns: repeat(3, 1fr);
  backdrop-filter: blur(14px);
  background: color-mix(in srgb, var(--tg-bg, var(--brand-cream)) 92%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent);
  padding-bottom: max(env(safe-area-inset-bottom, 0px), var(--tma-safe-bottom, 0px));
}
```

Also update the float-cart bottom offset (around line 483) so it clears the now-taller nav:

```css
/* was: bottom: calc(64px + env(safe-area-inset-bottom, 0px)); */
bottom: calc(64px + max(env(safe-area-inset-bottom, 0px), var(--tma-safe-bottom, 0px)));
```

## Shell Integration — `web/src/app/(miniapp)/components/MiniAppShell.tsx`

Single line added near top of component:

```ts
import { useTmaViewport } from '@/lib/telegram'
// ...
export function MiniAppShell({ ... }) {
  useTmaViewport()
  // existing body unchanged
}
```

Existing `useTelegramBackButton`, `useQuery({queryKey:['shop','info']})`, and the auth flow in `AuthBoundary` are not touched. `useWebApp` (theme) continues to fire from `AuthBoundary`.

## Data Flow

1. Page loads → `(miniapp)/layout.tsx` already declares `viewportFit: 'cover'` → iOS WebView exposes `env(safe-area-inset-top)` ≥ 0.
2. `MiniAppShell` mounts → `useTmaViewport` runs.
3. Hook reads current `contentSafeAreaInset` (may be all-0 if pre-8.0) → writes CSS vars.
4. Telegram client emits `safeAreaChanged` / `contentSafeAreaChanged` on orientation change, fullscreen toggle, or expand → hook rewrites vars.
5. CSS `max()` always picks the larger of env-vs-TMA value. On non-TMA web preview, CSS vars are unset → `var(--tma-safe-top, 0px)` resolves to 0 → only env applies (no regression).

## Error Handling

- Missing `WebApp.onEvent` (very old clients) → optional chaining no-ops; insets still seeded once on mount with whatever fields exist.
- Missing `contentSafeAreaInset` and `safeAreaInset` → defaults `{0,0,0,0}` → CSS vars set to `0px` → max() falls through to env().
- `disableVerticalSwipes` missing → optional chaining no-op.
- No try/catch wrapping the hook: any thrown error from TMA is a platform bug we want surfaced, and the hook contains no user-input paths.

## Testing

Manual verification — no automated TMA testing infra in repo today.

1. **iOS Safari devtools (`localhost:3001`)** with "Show Device Frame" on iPhone 14 Pro:
   - `env(safe-area-inset-top)` resolves to ~47px.
   - Header brand "Taikhoantenhat" + favicon visible fully below notch.
2. **Android Chrome devtools** (Pixel 7 preset): insets all 0; header padding-top = 0; layout matches pre-fix.
3. **Real iPhone with notch via Telegram TMA**:
   - Half-screen state: header sits below Close/chevron row.
   - After `expand()`: header sits below notch only (chrome moved out).
   - Bottom nav clears home indicator.
4. **Real Android via Telegram TMA**: no regressions; insets remain 0.
5. **Non-TMA web** (`/` opened in regular browser): `getWebApp()` returns null → hook early-returns → env-only behavior; iOS Safari still gets notch inset, Android Chrome gets 0.

Verification commands:
- `cd web && npm run dev` then open `http://localhost:3001/` in Chrome devtools mobile mode.
- For real-device TMA: requires deploy or tunnel; covered by existing `allowedDevOrigins` in `web/next.config.ts`.

## Out of Scope

- Fullscreen mode (Bot API 8.0 `requestFullscreen`) — separate feature, not required for the notch fix.
- Persisting fullscreen across sessions.
- Admin routes (already on regular browser layout).
- Migration to `@telegram-apps/sdk-react` package.

## Affected Files

| Path | Change |
|---|---|
| `web/src/lib/telegram.ts` | Extend interface; add `useTmaViewport` hook; add `writeInsets` helper. |
| `web/src/app/globals.css` | `.miniapp-root` adds horizontal insets; `.miniapp-header` adds top inset; `.miniapp-bottomnav` widens existing bottom rule; float-cart offset updated. |
| `web/src/app/(miniapp)/components/MiniAppShell.tsx` | Import + call `useTmaViewport()` once. |
