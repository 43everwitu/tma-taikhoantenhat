# Sub-project D: Feature Gating

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Hide wallet/topups + telegram broadcast notifications via `.env` flags. Admin sidebar filters accordingly; backend routes 404 when disabled.

**Architecture:** New env vars resolved in `config.js`. `GET /api/v1/admin/features` returns map. AdminSidebar consumes it. Hidden routes return 404 in layout guard.

---

## Tasks

### Task 1: Config + features endpoint

**Files:**
- Modify: `src/config.js` (add FEATURE_TOPUPS, FEATURE_BROADCAST, FEATURE_TELEGRAM_NOTIFY)
- Modify: `.env.example`
- Create: `src/api/routes/admin/features.js`
- Modify: `src/api/routes/admin/index.js`

- [ ] **Step 1:** Read `src/config.js`. Add the three vars to the exported object (use `process.env.X === 'false' ? false : true` for defaults — default ON, opt-out):
```js
FEATURE_TOPUPS: process.env.FEATURE_TOPUPS === 'true',
FEATURE_BROADCAST: process.env.FEATURE_BROADCAST === 'true',
FEATURE_TELEGRAM_NOTIFY: process.env.FEATURE_TELEGRAM_NOTIFY || 'order_only',
```

Defaults: topups OFF (false), broadcast OFF (false), telegram_notify=order_only. Admin opts in by setting env to `'true'` / `'full'`.

- [ ] **Step 2:** Append to `.env.example`:
```
# ================================================
# Feature flags (sub-project D)
# ================================================
FEATURE_TOPUPS=false
FEATURE_BROADCAST=false
FEATURE_TELEGRAM_NOTIFY=order_only  # order_only | full
```

- [ ] **Step 3:** Create `src/api/routes/admin/features.js`:
```js
const { Router } = require('express');
const config = require('../../../config');

const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      topups: !!config.FEATURE_TOPUPS,
      broadcast: !!config.FEATURE_BROADCAST,
      telegramNotify: config.FEATURE_TELEGRAM_NOTIFY || 'order_only',
    },
  });
});

module.exports = router;
```

- [ ] **Step 4:** Mount in `src/api/routes/admin/index.js`:
```js
router.use('/features', require('./features'));
```

- [ ] **Step 5:** Reload + verify:
```bash
touch src/index.js && sleep 3
node -e "require('dotenv').config(); fetch('http://localhost:3000/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.ADMIN_INITIAL_PASSWORD})}).then(r=>r.json()).then(j=>fetch('http://localhost:3000/api/v1/admin/features',{headers:{Authorization:'Bearer '+j.data.token}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d))))"
```
Expected: `{"success":true,"data":{"topups":false,"broadcast":false,"telegramNotify":"order_only"}}`.

- [ ] **Step 6:** Commit:
```bash
git add src/config.js .env.example src/api/routes/admin/features.js src/api/routes/admin/index.js
git commit -m "feat(admin-api): GET /admin/features + FEATURE_TOPUPS / FEATURE_BROADCAST / FEATURE_TELEGRAM_NOTIFY env flags"
```

### Task 2: Sidebar filters by features

**Files:**
- Modify: `web/src/components/AdminSidebar.tsx`

- [ ] **Step 1:** Read the file. Find the `NAV` (or equivalent) array. Add a feature-flag predicate per item:

For the `topups` item, attach `feature: 'topups'`. For the `messages` item (broadcast-only feature in this app's vocabulary), attach `feature: 'broadcast'`.

- [ ] **Step 2:** At the top of the component, fetch features via TanStack Query:
```tsx
const { data: features } = useQuery({
  queryKey: ['admin', 'features'],
  queryFn: () => api.get<{ topups: boolean; broadcast: boolean; telegramNotify: string }>('/admin/features'),
  staleTime: 5 * 60 * 1000,
})
const featureMap = features?.data ?? { topups: false, broadcast: false, telegramNotify: 'order_only' }
```

(Import `useQuery` + `api` if not already.)

- [ ] **Step 3:** Filter the rendered nav items:
```tsx
const visible = NAV.filter((it) => !it.feature || (featureMap as any)[it.feature] !== false)
```

(Adapt the variable name to whatever the existing array is called.)

- [ ] **Step 4:** Verify:
```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/admin
```

- [ ] **Step 5:** Commit:
```bash
git add web/src/components/AdminSidebar.tsx
git commit -m "feat(admin): sidebar filters items by FEATURE_TOPUPS / FEATURE_BROADCAST"
```

### Task 3: Tag

```bash
git tag v0.12-feature-gating -m "Sub-project D: feature flags for topups + broadcast"
```

---

## Self-Review

- D1 env vars → Task 1
- D2 /admin/features endpoint → Task 1
- D3 sidebar filter → Task 2
- D4 routes themselves left live (per design — re-enable is one env flip) → no route changes
