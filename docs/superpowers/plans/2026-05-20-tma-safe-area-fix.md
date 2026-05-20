# TMA Safe-Area Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Mini App header from rendering behind the iOS notch and Telegram's chrome bar; also pad bottom nav and root edges via TMA safe-area insets when reported by Bot API 8.0+.

**Architecture:** Hybrid solution: CSS `env(safe-area-inset-*)` is always-on (iOS WebView native), while a new React hook subscribes to TMA `safeAreaChanged` / `contentSafeAreaChanged` events and mirrors values into `:root` CSS custom properties. CSS rules use `max(env(...), var(--tma-safe-*, 0px))` so iOS notch is always covered and Telegram-reported chrome insets win when larger. Hook also calls `WebApp.disableVerticalSwipes()` to stop swipe-to-close interference with vertical rail scroll.

**Tech Stack:** Next.js 16 (Turbopack), React 19, plain CSS in `globals.css`, `window.Telegram.WebApp` via typed wrapper in `web/src/lib/telegram.ts`. No bundled test runner in `web/`; verification via `next build` (tsc) + `eslint` + manual Chrome devtools mobile preview.

**Spec:** `docs/superpowers/specs/2026-05-20-tma-safe-area-fix-design.md`

**Files touched (3):**

| Path | Responsibility |
|---|---|
| `web/src/lib/telegram.ts` | Extend `TelegramWebApp` interface with safe-area-related fields. Add `writeInsets` helper + `useTmaViewport` hook. |
| `web/src/app/globals.css` | `.miniapp-root` horizontal insets; `.miniapp-header` top inset; `.miniapp-bottomnav` widen existing bottom rule; float-cart offset (line ~483). |
| `web/src/app/(miniapp)/components/MiniAppShell.tsx` | Call `useTmaViewport()` once on mount. |

**Note on TDD:** `web/` has no test runner (only `next build` + `eslint`). The fix is a runtime/CSS visual behavior; primary verification is manual devtools preview + real-device TMA. Each task ends with a typecheck/lint and a commit.

---

## Task 1: Add `useTmaViewport` hook + interface extension to `telegram.ts`

**Files:**
- Modify: `web/src/lib/telegram.ts`

- [ ] **Step 1: Read current file to confirm baseline**

Run: `sed -n '1,98p' web/src/lib/telegram.ts`
Expected: Existing exports — `TelegramWebApp` interface, `getWebApp`, `useWebApp`, `applyThemeVars`. No `useTmaViewport`.

- [ ] **Step 2: Extend the `TelegramWebApp` interface**

In `web/src/lib/telegram.ts`, locate the `TelegramWebApp` interface (starts at line 24). Add the new fields **before** the closing brace (after `openLink(url: string): void` on line 55).

Insert the following block right after `openLink(url: string): void` and before the closing `}`:

```ts
  isExpanded?: boolean
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number }
  safeAreaInset?:        { top: number; bottom: number; left: number; right: number }
  onEvent?: (event: 'safeAreaChanged' | 'contentSafeAreaChanged' | 'viewportChanged', cb: () => void) => void
  offEvent?: (event: 'safeAreaChanged' | 'contentSafeAreaChanged' | 'viewportChanged', cb: () => void) => void
  disableVerticalSwipes?: () => void
  enableVerticalSwipes?: () => void
```

- [ ] **Step 3: Add `writeInsets` helper and `useTmaViewport` hook**

Append to the **end** of `web/src/lib/telegram.ts` (after `applyThemeVars`, around line 98):

```ts

function writeInsets(wa: TelegramWebApp) {
  const ci = wa.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const sa = wa.safeAreaInset        ?? { top: 0, bottom: 0, left: 0, right: 0 }
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

Note: `useEffect` is already imported on line 3 (`import { useEffect, useState } from 'react'`). No new imports needed.

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exits 0, no errors. (If a stale `dev` server is running, this is safe in parallel.)

- [ ] **Step 5: Lint**

Run: `cd web && npx eslint src/lib/telegram.ts`
Expected: exits 0, no warnings.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/telegram.ts
git commit -m "feat(tma): add useTmaViewport hook + safe-area inset interface

Reads contentSafeAreaInset/safeAreaInset on mount and subscribes to
safeAreaChanged/contentSafeAreaChanged events. Writes values into
--tma-safe-{top,bottom,left,right} CSS custom properties. Also calls
expand() + disableVerticalSwipes() so the iOS swipe-to-close gesture
stops fighting vertical rail scroll."
```

---

## Task 2: Update CSS rules in `globals.css` to consume insets

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Verify baseline rules and their line numbers**

Run: `grep -n "miniapp-root\|miniapp-header\|miniapp-bottomnav\|env(safe-area-inset-bottom" web/src/app/globals.css | head -20`
Expected (approximately): `.miniapp-root` ~line 233, `.miniapp-header` ~line 240, `.miniapp-bottomnav` ~line 265, `padding-bottom: env(safe-area-inset-bottom, 0);` line 271, float-cart `bottom: calc(64px + env(safe-area-inset-bottom, 0px));` line 483.

- [ ] **Step 2: Add horizontal insets to `.miniapp-root`**

Find this block in `web/src/app/globals.css` (around line 233):

```css
  .miniapp-root {
    background: var(--tg-bg, var(--brand-cream));
    color: var(--tg-text, var(--brand-ink));
    min-height: 100dvh;
  }
```

Replace it with:

```css
  .miniapp-root {
    background: var(--tg-bg, var(--brand-cream));
    color: var(--tg-text, var(--brand-ink));
    min-height: 100dvh;
    padding-left:  max(env(safe-area-inset-left,  0px), var(--tma-safe-left,  0px));
    padding-right: max(env(safe-area-inset-right, 0px), var(--tma-safe-right, 0px));
  }
```

- [ ] **Step 3: Add top inset to `.miniapp-header`**

Find this block (around line 240):

```css
  /* Header with subtle gradient + sticky blur */
  .miniapp-header {
    position: sticky; top: 0; z-index: 20;
    backdrop-filter: blur(14px);
    background: color-mix(in srgb, var(--tg-bg, var(--brand-cream)) 88%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent);
  }
```

Replace it with:

```css
  /* Header with subtle gradient + sticky blur */
  .miniapp-header {
    position: sticky; top: 0; z-index: 20;
    backdrop-filter: blur(14px);
    background: color-mix(in srgb, var(--tg-bg, var(--brand-cream)) 88%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent);
    padding-top: max(env(safe-area-inset-top, 0px), var(--tma-safe-top, 0px));
  }
```

- [ ] **Step 4: Widen `.miniapp-bottomnav` bottom padding**

In the `.miniapp-bottomnav` block (starts around line 265), find this line:

```css
    padding-bottom: env(safe-area-inset-bottom, 0);
```

Replace with:

```css
    padding-bottom: max(env(safe-area-inset-bottom, 0px), var(--tma-safe-bottom, 0px));
```

- [ ] **Step 5: Update float-cart offset**

Find this line (around line 483):

```css
    bottom: calc(64px + env(safe-area-inset-bottom, 0px));
```

Replace with:

```css
    bottom: calc(64px + max(env(safe-area-inset-bottom, 0px), var(--tma-safe-bottom, 0px)));
```

- [ ] **Step 6: Verify no other consumers of `env(safe-area-inset-bottom)` need update**

Run: `grep -n "safe-area-inset" web/src/app/globals.css`
Expected: four matches now — one in `.miniapp-root` (left), one in `.miniapp-root` (right), one in `.miniapp-header` (top), one in `.miniapp-bottomnav` (bottom), one in float-cart `bottom: calc(...)`. **5 lines total.** If any other `env(safe-area-inset-*)` references remain without an accompanying `var(--tma-safe-*)`, audit them and apply the same `max()` pattern. (If none exist beyond those listed, this step is complete.)

- [ ] **Step 7: Lint**

Run: `cd web && npx eslint src/app/globals.css || true`
Expected: ESLint may not lint CSS — exit code may be non-zero with "no parser" message; that's fine. The real check is the build step.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/globals.css
git commit -m "fix(miniapp): apply safe-area insets to header, root, and bottom nav

Header now padded by max(env(safe-area-inset-top), --tma-safe-top) so
brand mark + nav row clear iOS notch and Telegram chrome. Root takes
horizontal insets for landscape edge cases. Bottom-nav and float-cart
upgraded to also pick up TMA contentSafeAreaInset on Bot API 8.0+."
```

---

## Task 3: Wire `useTmaViewport` into `MiniAppShell`

**Files:**
- Modify: `web/src/app/(miniapp)/components/MiniAppShell.tsx`

- [ ] **Step 1: Verify current imports and component signature**

Run: `sed -n '1,40p' 'web/src/app/(miniapp)/components/MiniAppShell.tsx'`
Expected: First import block uses `from '@/lib/...'` style. `useTelegramBackButton` imported from `@/lib/useTelegramBackButton`. Component `MiniAppShell` opens around line 22.

- [ ] **Step 2: Add import for `useTmaViewport`**

In `web/src/app/(miniapp)/components/MiniAppShell.tsx`, find this line (line 8):

```ts
import { useTelegramBackButton } from '@/lib/useTelegramBackButton'
```

Insert the following line **immediately after** it:

```ts
import { useTmaViewport } from '@/lib/telegram'
```

- [ ] **Step 3: Call the hook inside the component**

Find this block (around line 35-39 inside `MiniAppShell`):

```ts
  const pathname = usePathname()
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const onBack = useCallback(() => { router.back() }, [router])
  useTelegramBackButton(pathname !== '/', onBack)
```

Insert `useTmaViewport()` **above** `const pathname = usePathname()` so it runs first:

```ts
  useTmaViewport()
  const pathname = usePathname()
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const onBack = useCallback(() => { router.back() }, [router])
  useTelegramBackButton(pathname !== '/', onBack)
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 5: Lint the file**

Run: `cd web && npx eslint 'src/app/(miniapp)/components/MiniAppShell.tsx'`
Expected: exits 0, no warnings.

- [ ] **Step 6: Commit**

```bash
git add 'web/src/app/(miniapp)/components/MiniAppShell.tsx'
git commit -m "fix(miniapp): mount useTmaViewport in MiniAppShell

Calls ready/expand/disableVerticalSwipes once per shell mount and
subscribes to safe-area events so CSS vars are populated before the
header paints."
```

---

## Task 4: Verification — build, lint, manual devtools check

**Files:** (no edits — verification only)

- [ ] **Step 1: Production build (typecheck + bundle)**

Run: `cd web && npm run build`
Expected: build completes, no TypeScript errors, no lint errors that fail the build. Look for the line `Compiled successfully` (Next 16 wording may vary). If the build fails, revert the offending task and re-do.

- [ ] **Step 2: Start dev server**

Run: `cd web && npm run dev` (in a background terminal — `./dev-all.sh` from repo root also works if mbbank + api are already running)
Expected: `▲ Next.js 16.2.6 (Turbopack)` line, `Ready in <Nms>` line, no compile errors.

- [ ] **Step 3: Manual check — iPhone 14 Pro devtools preset (with device frame)**

Open Chrome → DevTools → toggle device toolbar (Cmd+Shift+M) → choose `iPhone 14 Pro` → enable "Show device frame" (kebab menu inside device toolbar) → navigate to `http://localhost:3001/`.

Verify:
- Brand mark + "Taikhoantenhat" title sit **fully below** the simulated notch — no overlap.
- Bottom nav (`Trang chủ / Giỏ hàng / Đơn hàng`) sits above the home indicator, with visible padding.
- No layout shift after page settles (`env(safe-area-inset-top)` resolves during initial paint, no FOUC).

- [ ] **Step 4: Manual check — Android Pixel preset**

Devtools → `Pixel 7` → reload `http://localhost:3001/`.

Verify:
- Header has no extra top padding (Pixel preset reports `env(safe-area-inset-top) = 0`).
- Layout matches behavior prior to this change (no regression).

- [ ] **Step 5: Manual check — regular desktop view**

Resize devtools off mobile mode (Cmd+Shift+M again) → view at 1280×720.

Verify:
- Header renders without the mobile inset (env() is 0 on desktop Chrome, `--tma-safe-top` unset → max() resolves to 0).
- Top nav links visible at same vertical position as before.

- [ ] **Step 6: Stop dev server**

Run: `lsof -ti :3001 | xargs kill -9 2>/dev/null; true`
Expected: dev server process killed (no output if no PID held the port).

- [ ] **Step 7: Final smoke commit (only if any fix-ups landed during verification)**

If Steps 3–5 surfaced no issues, **skip this step**. If a fix was needed:

```bash
git add <touched files>
git commit -m "fix(miniapp): <specific issue from manual verification>"
```

- [ ] **Step 8: Open PR description bullet (for the eventual squash/merge)**

Add to PR notes (no file change yet):
- "Mini App header now clears iOS notch and Telegram chrome on Bot API 8.0+ clients."
- "Bottom nav + float-cart pick up `contentSafeAreaInset.bottom` symmetrically."
- "Adds `disableVerticalSwipes()` to stop swipe-to-close from hijacking vertical scroll."

---

## Notes for the executing subagent

- Never widen scope beyond these 3 files. If a tangential issue appears (e.g., a different sticky element needs an inset), open a follow-up — do not include it here.
- `web/` has no Jest/Vitest. Don't try to add one for this fix. `next build` + manual devtools are the verification path.
- `useTmaViewport` must remain a separate hook from the existing `useWebApp`. `useWebApp` is still mounted by `AuthBoundary` for theme params — leave that wiring untouched.
- Branch is `feat/v0.33-admin-stock-poller`; create a topic branch `fix/tma-safe-area` off the current head before Task 1 if working in a worktree.
