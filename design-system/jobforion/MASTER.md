# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** JobForion
**Category:** Job Board / Recruitment
**Source of truth:** `src/styles/shared-css.js` (tokens + shell), `src/styles/job-card-css.js` (job cards), `src/styles/accounts-css.js` (account/company area). This file DOCUMENTS those tokens. If the two ever disagree, **the CSS wins** — update this file.

**History:** First generated on 2026-10-25 by `ui-ux-pro-max-skill`. Its generated suggestions (Poppins + Open Sans, primary `#0369A1`, "Flat Design" with no gradients/shadows, a Funnel page pattern) were deliberately **NOT adopted**: they contradict JobForion's established white & blue identity. The skill is used here only as a checklist and anti-pattern source. Reconciled with the production tokens in the UI/UX audit (P0).

---

## Global Rules

### Color Palette (production tokens)

| Role | Value | CSS Variable | Notes |
|------|-------|--------------|-------|
| Brand | `#2563EB` | `--brand` | Links, primary buttons, focus ring (≈ 5.2:1 on white) |
| Brand hover | `#1D4ED8` | `--brand2` | Gradient end / hover |
| Brand soft | `rgba(37,99,235,.10)` | `--brand-soft` | Tinted backgrounds, hover fills |
| Background | `#FFFFFF` | `--bg` | Page |
| Background alt | `#F8FAFC` | `--bg2` | Scrollbar track, subtle areas |
| Surface | `#FFFFFF` | `--surface` | Cards, modals |
| Surface alt | `#F1F5F9` | `--surface2` | Inputs, tags, ad slots |
| Border | `#E2E8F0` / `#CBD5E1` | `--border` / `--border2` | Dividers / input borders |
| Text | `#0F172A` | `--ink` | Headings, titles |
| Text secondary | `#475569` | `--ink2` | Body copy, labels (≈ 7.6:1 on white) |
| Text muted | `#64748B` | `--ink3` | Meta only (≈ 4.8:1 on white, ≈ 4.4:1 on `--surface2`) |
| Navy (footer) | `#0F172A` / `#172554` | `--navy` / `--navy2` | Footer + dark areas |
| Salary / success text | `#15803D` | `--salary` | AA text colour (≈ 5.0:1). Never use `#16A34A` or `--green` for text |
| Decorative accents | `--green` `--amber` `--coral` `--cyan` `--pink` | — | **Fills, dots, borders only** — they fail 4.5:1 as small text |

**Contrast rules**
- Body/meta text must reach **4.5:1**; large text and UI boundaries (focus rings, input borders) **3:1**.
- On tinted backgrounds (`--surface2`, `--brand-soft`, pastels) use `--ink2` or darker, not `--ink3`.
- Category hues (`--cat-color`) colour the **dot**, never the label text.
- Admin theme variables (`--card-*-color`) may override colours: their fallbacks must stay AA tokens.

### Typography

- **Headings:** Plus Jakarta Sans (`--font-heading`)
- **Body:** Inter (`--font-body`)
- **Numbers (salary):** JetBrains Mono (`--font-mono`)
- **Mood:** modern, professional, clean, friendly
- Minimum sizes: body 14px+, secondary meta 12px+, tags/badges 11.5–12px. Form fields are **16px on phones** (prevents iOS zoom).

### Spacing, Shape & Elevation

- Base radius `--r: 12px`; controls 8–10px; modals 16px; pills 20px.
- Elevation tokens: `--shadow`, `--shadow-lg`, `--shadow-card`, `--shadow-card-hover`. Cards use a border first, shadow second.
- Touch targets: **44px minimum on phones** (see the touch layer in `shared-css.js`).

### Icons

- **Lucide only**, via `src/assets/icons.js` (inline SVG, `currentColor`, `aria-hidden`). No emoji as UI icons.
- Icon-only buttons need an `aria-label`.

### Motion

- Colour/shadow transitions 150–200ms only. No entrance animations on lists, no scale-on-hover on touch devices.
- Everything animated must be disabled by `prefers-reduced-motion` (already global).

---

## Component Specs

- **Primary button** (`.nav-cta`, `.pj-submit`, `.apply-big`): brand → brand2 gradient, white text, radius 8–9px, weight 800.
- **Job card** (`.job-card`): border `--border`, radius `--r`, `contain: layout paint style`; title `--ink`, company `--ink2`, meta `--ink3`, salary `--salary` in mono.
- **Inputs** (`.pj-input`, `.form-input`): `--surface2` fill, 1.5px `--border2`, focus = `--brand` border + `--brand-soft` ring **and** a visible outline.
- **Modal** (`.pj-overlay`/`.pj-modal`): `role="dialog"` + `aria-modal` + labelled title, Escape closes, Tab is trapped, focus returns to the opener, errors inline with `role="alert"`.
- **Focus ring** (global): `3px solid var(--brand)`, offset 2px; `#93C5FD` on the dark footer.

---

## Anti-Patterns (Do NOT Use)

- ❌ Emojis as icons — use Lucide SVG
- ❌ Colour as the only carrier of meaning (status, category, required)
- ❌ Low-contrast text (< 4.5:1), including admin-configurable colours
- ❌ Invisible or near-transparent focus states
- ❌ `window.alert()` for validation errors — use inline `role="alert"` messages
- ❌ Unlabelled form fields (placeholder is not a label)
- ❌ Layout-shifting hovers / scale transforms on touch devices
- ❌ Instant state changes — always transition (150–300ms)
- ❌ Hidden filters, outdated forms
- ❌ Rendering admin-supplied URLs/colours without validation (see `lib/content/nav-buttons.js`)

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons; all icons from `assets/icons.js` (Lucide)
- [ ] `cursor:pointer` on every clickable element; hover transitions 150–300ms
- [ ] Text contrast ≥ 4.5:1 (meta on tinted backgrounds uses `--ink2`)
- [ ] Every input has an associated `<label for>`; required fields marked
- [ ] Focus visible for keyboard navigation; modals trap and restore focus
- [ ] `prefers-reduced-motion` respected
- [ ] Touch targets ≥ 44px on phones; form fields 16px on phones
- [ ] Responsive: 375px, 768px, 1024px, 1440px; no horizontal scroll on mobile
- [ ] No content hidden behind sticky/fixed bars
- [ ] All user/admin/provider data escaped (`escapeHtml`) before reaching HTML
