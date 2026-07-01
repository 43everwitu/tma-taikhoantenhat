# Create Shop Product Skill Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the local `create-shop-product` skill so product images use brand/logo colors and product copy follows a reusable Taikhoantenhat-style template.

**Architecture:** This is a documentation-only skill update. `SKILL.md` carries the short rules Codex sees first; `references/taikhoantenhat-product-workflow.md` carries the detailed image and copy workflow. Validation uses the existing `quick_validate.py` skill validator.

**Tech Stack:** Codex skill Markdown, local skill metadata, shell validation.

---

### Task 1: Update Quick Skill Rules

**Files:**
- Modify: `/home/peanut/.codex/skills/create-shop-product/SKILL.md`

- [ ] **Step 1: Open current skill file**

Run:

```bash
sed -n '1,220p' /home/peanut/.codex/skills/create-shop-product/SKILL.md
```

Expected: file contains `Product Style Defaults` with the current generic image rule.

- [ ] **Step 2: Replace the product image default bullet**

In `/home/peanut/.codex/skills/create-shop-product/SKILL.md`, replace:

```markdown
- Product image style: square 900x900, dark gradient background, large title, central logo/app tile, small badge, large mobile-readable footer, tiny `taikhoantenhat.com`.
```

with:

```markdown
- Product image style: square 900x900, gradient background built from 1-3 primary logo/brand colors when available, large mobile-readable title, central logo/app tile, small package badge, large footer label, tiny `taikhoantenhat.com`.
```

- [ ] **Step 3: Add copy-template rule**

In the same `Product Style Defaults` list, add this bullet after the image style bullet:

```markdown
- Product copy should follow a reusable shop template: short description with plan/duration/benefit/delivery, long description with headings and feature bullets, and usage instructions with login or activation steps. Read similar products only when the input is sparse, the product is unfamiliar, or category/style is uncertain.
```

- [ ] **Step 4: Re-read the updated section**

Run:

```bash
sed -n '/## Product Style Defaults/,$p' /home/peanut/.codex/skills/create-shop-product/SKILL.md
```

Expected: `Product Style Defaults` mentions brand-color gradient, logo/app tile, package badge, footer label, and the copy-template fallback rule.

### Task 2: Expand Detailed Product Workflow Reference

**Files:**
- Modify: `/home/peanut/.codex/skills/create-shop-product/references/taikhoantenhat-product-workflow.md`

- [ ] **Step 1: Open image and copy sections**

Run:

```bash
sed -n '/## Image Workflow/,/## Upsert Pattern/p' /home/peanut/.codex/skills/create-shop-product/references/taikhoantenhat-product-workflow.md
```

Expected: output includes `## Image Workflow`, `Shop cover style`, and `## Copywriting Structure`.

- [ ] **Step 2: Add brand-color image rules**

Under `Shop cover style:`, replace the current bullets with:

```markdown
- Square 900x900 WebP.
- Background gradient derived from 1-3 primary logo/brand colors when a logo or reliable brand source exists.
- If the logo has one dominant color, pair it with a darker neutral or deeper shade for contrast.
- If the logo colors are too bright for readable white text, keep the brand color as an accent and use a darker supporting gradient.
- Large white title at top, sized for small mobile screens.
- Small badge near title: `EDU`, `VIP+`, `PRO`, `GO`, `12M`, `24M`, etc.
- Central app tile/logo using the real brand logo when available.
- Large footer label optimized for mobile, using a short product name or variant labels.
- Tiny `taikhoantenhat.com` watermark.
```

- [ ] **Step 3: Add image source rule**

Immediately after the `Shop cover style:` bullets, add:

```markdown
When the user provides a logo URL, use that logo. When no logo is provided but the brand is recognizable, use a trusted official or marketplace source if available. Do not invent a logo. If no reliable logo exists, use a clean text/app-tile treatment and state that the logo was not available.
```

- [ ] **Step 4: Replace copywriting section with concrete template**

Replace the body under `## Copywriting Structure` up to `## Upsert Pattern` with:

```markdown
## Copywriting Structure

Use a static shop-style template by default. Read similar products from `data/shop.db` or public catalog only when:

- The user gives sparse input.
- The product/category is unfamiliar.
- Tone, structure, or detail level is uncertain.

Short description:

- One compact sentence or paragraph.
- Include plan name, duration, main benefit, and delivery mode.
- Keep claims grounded in user-provided facts or reliable product information.

Long description:

- Use `<h2>` headings.
- Use `<ul><li>` bullets for features, delivery details, and notes.
- Use `<table>` only when comparison or package options are useful.
- State whether delivery is automatic stock-key, backorder/manual, or customer-input upgrade.
- Add warnings exactly when relevant, such as trial/device/account limitations.

Recommended long-description sections:

```html
<h2>Thông tin gói</h2>
<ul>
  <li>...</li>
</ul>
<h2>Bạn nhận được gì?</h2>
<ul>
  <li>...</li>
</ul>
<h2>Lưu ý</h2>
<ul>
  <li>...</li>
</ul>
```

Usage instructions:

- Keep it operational.
- Include login format such as `<code>email|pass</code>` if applicable.
- Include activation, login, or upgrade steps based on fulfillment mode.
- Include troubleshooting steps the customer needs after delivery.

Do not claim vendor warranties. If warranty is shop-provided, say it is shop policy and only when the user provided that policy.
```

- [ ] **Step 5: Re-read the modified reference**

Run:

```bash
sed -n '/## Image Workflow/,/## Upsert Pattern/p' /home/peanut/.codex/skills/create-shop-product/references/taikhoantenhat-product-workflow.md
```

Expected: reference includes brand-color gradient rules, logo-source rule, static copy template, and sample HTML sections.

### Task 3: Validate Skill

**Files:**
- Read: `/home/peanut/.codex/skills/create-shop-product/SKILL.md`
- Read: `/home/peanut/.codex/skills/create-shop-product/references/taikhoantenhat-product-workflow.md`

- [ ] **Step 1: Run skill validator**

Run:

```bash
python3 /home/peanut/.codex/skills/.system/skill-creator/scripts/quick_validate.py /home/peanut/.codex/skills/create-shop-product
```

Expected:

```text
Skill is valid!
```

- [ ] **Step 2: Search for contradictions**

Run:

```bash
rg -n "dark gradient background|read similar products.*every" /home/peanut/.codex/skills/create-shop-product
```

Expected: no stale `dark gradient background` and no requirement to read similar products every time.

- [ ] **Step 3: Report result**

Summarize:

```text
Updated create-shop-product skill with brand-color image guidance and reusable product-copy template. Validator passed.
```
