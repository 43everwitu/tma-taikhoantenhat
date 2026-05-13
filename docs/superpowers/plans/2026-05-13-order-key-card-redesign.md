# Order Key Card Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the customer order page key block readable: light card style, tidy icon-only copy button, prominent link chips for any URLs found in the key text.

**Architecture:** New `.miniapp-key-card` CSS (white background, soft border, monospace body). `KeyRow` renders body text with inline auto-linked URLs, separates extracted URLs into tappable chips below, and exposes an icon-only copy button anchored top-right. Toast/badge feedback after copy.

**Tech Stack:** Next 16, React 19, Tailwind v4, lucide-react.

---

### Task 1: New CSS card style

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Replace `.miniapp-key` rules with light card + add `.miniapp-key-card-*`**

Locate the existing `.miniapp-key` block (around line 495). Replace with:

```css
.miniapp-key-card {
  position: relative;
  padding: .75rem .875rem;
  padding-right: 2.75rem;
  border-radius: 14px;
  background: #fff;
  border: 1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent);
  font-family: var(--font-mono);
  font-size: .8125rem;
  line-height: 1.55;
  color: var(--brand-ink);
  word-break: break-word;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.miniapp-key-card a {
  color: var(--brand-gold-deep, #b88500);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.miniapp-key-copy-btn {
  position: absolute;
  top: .5rem;
  right: .5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--brand-gold-soft, #fff7e0);
  color: var(--brand-ink);
  border: 1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent);
  cursor: pointer;
  transition: background .15s;
}
.miniapp-key-copy-btn:hover { background: var(--brand-gold, #ffc200); }
.miniapp-key-copy-btn[data-copied="true"] {
  background: #16a34a;
  color: #fff;
  border-color: #16a34a;
}
.miniapp-key-links {
  display: flex;
  flex-wrap: wrap;
  gap: .375rem;
  margin-top: .5rem;
}
.miniapp-key-link {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  padding: .25rem .625rem;
  border-radius: 999px;
  background: var(--brand-gold-soft, #fff7e0);
  color: var(--brand-ink);
  font-size: .75rem;
  font-weight: 500;
  text-decoration: none;
  border: 1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent);
}
.miniapp-key-link:hover { background: var(--brand-gold, #ffc200); }
```

Drop the old `.miniapp-key` rule (light alternative replaces it; `KeyRow` no longer uses it).

- [ ] **Step 2: Commit**

```bash
git add web/src/app/globals.css
git commit -m "style(miniapp): light key card + icon copy button + link chips CSS"
```

---

### Task 2: Rewrite KeyRow component

**Files:**
- Modify: `web/src/app/(miniapp)/don-hang/[id]/page.tsx`

- [ ] **Step 1: Replace KeyRow + linkifyText helpers**

Find the existing `linkifyText` and `KeyRow` at the bottom of the file. Replace both with:

```tsx
const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g

function linkifyText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  let idx = 0
  URL_REGEX.lastIndex = 0
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index))
    const href = m[0]
    parts.push(
      <a key={`u-${idx++}`} href={href} target="_blank" rel="noopener noreferrer">{href}</a>
    )
    lastIndex = m.index + href.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function extractUrls(text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (!out.includes(m[0])) out.push(m[0])
  }
  return out
}

function shortenUrl(u: string): string {
  try {
    const url = new URL(u)
    const host = url.hostname.replace(/^www\./, '')
    const path = url.pathname.length > 24 ? url.pathname.slice(0, 22) + '…' : url.pathname
    return host + (path === '/' ? '' : path)
  } catch {
    return u
  }
}

function KeyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const urls = extractUrls(value)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  return (
    <li className="miniapp-key-card">
      <button
        type="button"
        onClick={copy}
        data-copied={copied ? 'true' : 'false'}
        aria-label={copied ? 'Đã sao chép' : 'Sao chép'}
        className="miniapp-key-copy-btn"
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
      <div>{linkifyText(value)}</div>
      {urls.length > 0 && (
        <div className="miniapp-key-links">
          {urls.map((u, i) => (
            <a key={`l-${i}`} href={u} target="_blank" rel="noopener noreferrer" className="miniapp-key-link">
              <Icon name="arrowRight" size={12} />
              {shortenUrl(u)}
            </a>
          ))}
        </div>
      )}
    </li>
  )
}
```

(`Icon` name `check` exists in icon map as `check: CheckCircle2`; `copy` is also present in the icon map.)

- [ ] **Step 2: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Visual smoke**

Open `/don-hang/100002` (a delivered order with a long key that includes URLs). Expected:
- Key text inside a light/white card with monospace text, subtle border
- Icon-only copy button (clipboard) anchored top-right; on tap it flips to a green check for ~1.6s
- URLs inline within the text are gold underlined links
- Below the text: small pill chips for each URL ("order.taikhoantenhat.com/44f69a84", "huongdan.taikhoantenhat.com/…") that tap to open the link

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/don-hang/\[id\]/page.tsx
git commit -m "feat(miniapp): KeyRow uses light card + icon copy + URL chip pills"
```

---

### Task 3: Final build verify

- [ ] **Step 1: Build**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit && npm run build
```
Expected: clean.
