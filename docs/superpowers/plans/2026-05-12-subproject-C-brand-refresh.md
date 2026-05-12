# Sub-project C: Brand Refresh

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Unify shop branding — favicon (cat icon at `favicon.png`), full Next 16 metadata (title/description/openGraph/themeColor), audit shop-name literals.

**Architecture:** Use Next 16 file-based metadata for the favicon (`web/src/app/icon.png`). Extend root `metadata` export. Grep + replace any hard-coded `'Taikhoantenhat'` literals that should reference `t.appName`.

**Tech Stack:** Next 16 App Router metadata API.

---

## Tasks

### Task 1: Place favicon as Next file-based icon

**Files:**
- Create: `web/src/app/icon.png` (copy of repo-root `favicon.png`)
- Delete: `web/public/favicon.ico`, `web/public/favicon.png` (old defaults; Next file-based icon supersedes)

- [ ] **Step 1:** 
```bash
cp "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/favicon.png" "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web/src/app/icon.png"
rm "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web/public/favicon.ico" "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web/public/favicon.png"
```

- [ ] **Step 2:** Verify Next picks it up: `curl -sI http://localhost:3001/icon.png | head -3` → 200.

- [ ] **Step 3:** Commit:
```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/icon.png web/public/
git commit -m "feat(web): replace default favicon with brand cat icon via Next icon.png"
```

### Task 2: Extend root metadata

**Files:**
- Modify: `web/src/app/layout.tsx`

- [ ] **Step 1:** Replace the metadata block with:

```tsx
export const metadata: Metadata = {
  title: {
    default: 'Taikhoantenhat',
    template: '%s · Taikhoantenhat',
  },
  description: 'Cửa hàng tài khoản số chính chủ — mua trong Telegram, giao key tự động, bảo hành dài hạn.',
  applicationName: 'Taikhoantenhat',
  openGraph: {
    title: 'Taikhoantenhat',
    description: 'Cửa hàng tài khoản số chính chủ — mua trong Telegram, giao key tự động.',
    type: 'website',
    locale: 'vi_VN',
  },
  themeColor: '#ffc200',
}
```

- [ ] **Step 2:** `cd web && npx tsc --noEmit` → clean. `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/` → 200.

- [ ] **Step 3:** Commit:
```bash
git add web/src/app/layout.tsx
git commit -m "feat(web): rich metadata — title template, description, OG, themeColor"
```

### Task 3: Audit shop-name hardcodes

**Files:**
- Modify (if found): any TSX with literal `'Taikhoantenhat'` that should be `t.appName`

- [ ] **Step 1:** Grep:
```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
grep -rn "Taikhoantenhat" web/src/ --include='*.tsx' --include='*.ts' | grep -v "i18n/vi.ts" | grep -v "layout.tsx"
```

- [ ] **Step 2:** For each result that's a user-facing UI string in a React component, replace the literal with `{t.appName}` (and add the `import { t } from '@/i18n/vi'` if missing). Skip metadata strings (those stay hardcoded — they're set once at module top).

- [ ] **Step 3:** If anything changed, `cd web && npx tsc --noEmit` clean, commit:
```bash
git commit -am "feat(web): route shop-name literals through t.appName"
```

If no UI literals found (all were already in i18n / metadata), skip the commit.

### Task 4: Verify + tag

- [ ] **Step 1:**
```bash
cd web && npm run build 2>&1 | tail -5
```
Expected: clean build.

- [ ] **Step 2:**
```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git tag v0.10-brand -m "Sub-project C: favicon + metadata + brand audit"
```

- [ ] **Step 3:** Done.

---

## Self-Review

- C1 favicon → Task 1
- C2 metadata title/description/OG/themeColor → Task 2
- C3 shop-name unify → Task 3
