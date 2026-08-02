- **Framework:** Next.js 16 (App Router, `app/` directory, `"use client"` where needed)
- **Styling:** Tailwind CSS v4 (`@import "tailwindcss"`, `@theme inline {}` blocks in `globals.css`)
- **Icons:** `lucide-react`
- **HTTP:** `axios`
- **Cookies/Auth:** `js-cookie`
- **Toasts:** `react-hot-toast`
- **Font:** Geist Sans + Geist Mono (already configured via `next/font/google` in `layout.jsx`)
- **Animations:** Add **Framer Motion** - `framer-motion` package
- **Charts:** Add **Recharts** - `recharts` package
- **Language:** JavaScript (JSX), NOT TypeScript

**Current folder structure:**

```
frontend/
  app/
    (officer)/          <- ClaimOfficer panel (route group, no URL prefix)
      layout.jsx        <- Officer shell (header + nav)
      dashboard/
      claims/
      documents/
      notifications/
    admin/              <- HospitalAdmin panel
      layout.jsx        <- Admin shell (header + nav)
      dashboard/
      insurers/
      policies/
      officers/
    login/
    forgot-password/
    change-password/
    globals.css
    layout.jsx          <- Root layout (fonts, metadata, Providers)
    page.jsx            <- Root redirect
    providers.jsx       <- Auth context provider
  lib/
    auth-context.js     <- useAuth() hook
```

---

## 3. BRAND & DESIGN SYSTEM

### 3.1 Brand Identity

**Product name:** ClaimGuard
**Tagline:** "Catch errors before the insurer does."
**Domain:** Healthcare SaaS - trust, precision, professionalism. The UI must feel premium, clinical-yet-modern, and instill confidence.

### 3.2 Primary Brand Color - Indigo/Blue Gradient

The **current primary** in `globals.css` uses blue (`#3b82f6` -> `#2563eb` family). **Keep and extend this blue/indigo palette** as the ClaimGuard brand - it evokes trust and professionalism fitting for healthcare.

**Full ClaimGuard design token set (add/replace in `globals.css` `@theme inline {}`):**

```css
@theme inline {
  /* === PRIMARY - ClaimGuard Indigo/Blue === */
  --color-primary-50: #eef2ff;
  --color-primary-100: #e0e7ff;
  --color-primary-200: #c7d2fe;
  --color-primary-300: #a5b4fc;
  --color-primary-400: #818cf8;
  --color-primary-500: #6366f1; /* Brand core - Indigo-500 */
  --color-primary-600: #4f46e5; /* Primary action */
  --color-primary-700: #4338ca; /* Hover state */
  --color-primary-800: #3730a3; /* Dark accent */
  --color-primary-900: #312e81; /* Deepest */

  /* === SECONDARY - Cyan accent (data/AI feel) === */
  --color-secondary-400: #22d3ee;
  --color-secondary-500: #06b6d4;
  --color-secondary-600: #0891b2;

  /* === SEMANTIC === */
  --color-success-50: #f0fdf4;
  --color-success-100: #dcfce7;
  --color-success-500: #22c55e;
  --color-success-600: #16a34a;
  --color-success-700: #15803d;

  --color-warning-50: #fffbeb;
  --color-warning-100: #fef3c7;
  --color-warning-500: #f59e0b;
  --color-warning-600: #d97706;

  --color-error-50: #fef2f2;
  --color-error-100: #fee2e2;
  --color-error-500: #ef4444;
  --color-error-600: #dc2626;

  --color-info-50: #eff6ff;
  --color-info-500: #3b82f6;
  --color-info-600: #2563eb;

  /* === NEUTRALS === */
  --color-gray-50: #f8fafc;
  --color-gray-100: #f1f5f9;
  --color-gray-200: #e2e8f0;
  --color-gray-300: #cbd5e1;
  --color-gray-400: #94a3b8;
  --color-gray-500: #64748b;
  --color-gray-600: #475569;
  --color-gray-700: #334155;
  --color-gray-800: #1e293b;
  --color-gray-900: #0f172a;

  /* === SURFACE / BACKGROUND === */
  --color-surface: #ffffff;
  --color-surface-raised: #f8fafc;
  --color-surface-overlay: #f1f5f9;
  --color-bg-page: #f1f5f9;

  /* === TYPOGRAPHY === */
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  /* === RADIUS === */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-2xl: 1.5rem;
  --radius-full: 9999px;

  /* === SHADOWS === */
  --shadow-card:
    0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.07);
  --shadow-elevated:
    0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.08);
  --shadow-modal: 0 20px 60px -12px rgb(0 0 0 / 0.25);
  --shadow-glow-primary: 0 0 20px 0 rgb(99 102 241 / 0.25);
}
```

### 3.3 Gradient System

Use these gradients consistently across the app:

```
Hero/brand gradient - indigo to cyan:
  linear-gradient(135deg, #6366f1 0%, #4f46e5 50%, #06b6d4 100%)

Card accent gradient:
  linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)

Sidebar gradient:
  linear-gradient(180deg, #0f172a 0%, #1e293b 100%)

Risk score - Low:  linear-gradient(135deg, #22c55e, #16a34a)
Risk score - Med:  linear-gradient(135deg, #f59e0b, #d97706)
Risk score - High: linear-gradient(135deg, #ef4444, #dc2626)
```

### 3.4 UI Personality

- **Glassmorphism** on sidebars, modals, and overlay cards: `backdrop-filter: blur(16px); background: rgba(255,255,255,0.08);`
- **Dark sidebar** with white/light text (gradient from `#0f172a` to `#1e293b`)
- **Light content area** (`bg-gray-50` / `#f1f5f9`)
- **Micro-animations** everywhere: hover lifts, focus glows, page transitions via Framer Motion
- **Status badges** with color-coded backgrounds (Pending=gray, Processing=blue pulsing, Completed=green, Error=red)
- **Risk score chips** (Low=green, Medium=amber, High=red) - prominent and immediately readable

---

## 4. UX PRINCIPLES

1. **Visual hierarchy** - typography scale (text-xs to text-4xl), weight (400/500/600/700), contrast, whitespace.
2. **Affordance** - clear interactive cues: hover scale, focus ring `ring-2 ring-primary-500 ring-offset-2`, active press.
3. **Consistency** - same radius, shadow, spacing, motion timing (`duration-150` for micro, `duration-300` for page).
4. **Immediate feedback** - loading skeletons, toast notifications (react-hot-toast), optimistic UI.
5. **Error prevention** - inline form validation, confirm modals before destructive actions (deactivate user, cancel claim).
6. **Progressive disclosure** - complex forms in steps/tabs; details on demand in accordions/expandable rows.
7. **Accessibility (WCAG AA)** - `aria-label`, `role`, keyboard nav, visible focus rings, color + icon for status (never color alone).
8. **Healthcare precision** - numbers and statuses must always be clearly readable. Use monospace font for IDs, claim references, dates.

---

## 5. COMPONENT LIBRARY

Build these as reusable components in `lib/components/ui/`:

### Button

- Variants: primary, secondary, ghost, danger, icon
- States: default, hover (scale-105, shadow-glow-primary), active, disabled, loading
- Sizes: sm, md, lg
- Primary classes: `inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-primary-600 text-white hover:bg-primary-700 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed`

### Card / Panel

- White bg, rounded-xl, shadow-card
- Variants: default, elevated (shadow-elevated), glass (glassmorphism)
- Optional: gradient border via ring or pseudo-element
- Optional: colored left-border accent (4px solid primary-500)

### StatusBadge

- Props: status ("Pending" | "Processing" | "Completed" | "Error")
- Pending -> gray bg, gray text, Clock icon
- Processing -> indigo bg with pulsing dot animation, Loader icon
- Completed -> green bg, CheckCircle icon
- Error -> red bg, AlertCircle icon
- Always icon + text (never color-only)

### RiskScoreBadge

- Props: score ("Low" | "Medium" | "High")
- Low -> green gradient chip, ShieldCheck icon
- Medium -> amber gradient chip, ShieldAlert icon
- High -> red gradient chip with subtle pulse, ShieldX icon

### ConfidenceBar

- Props: percentage (0-100), fieldName
- Animated fill bar using Framer Motion (animate width on mount)
- Color: green >80%, amber 50-80%, red <50%
- Show percentage text on the right

### Modal

- Focus trap, backdrop blur (backdrop-blur-sm bg-black/40)
- Framer Motion: scale + opacity animation in/out
- Close on Escape key, close on backdrop click (with optional lock)
- Header, body, footer slots
- `role="dialog"` `aria-modal="true"` `aria-labelledby` for title

### DataTable

- Sortable columns with animated sort icon
- Pagination controls (prev/next + page numbers)
- Per-row hover highlight
- Responsive: horizontal scroll on mobile
- Empty state slot
- Loading state with skeleton rows
- `role="table"`, `scope="col"` on headers, `aria-sort` on sortable columns

### FileUploadZone

- Drag-and-drop PDF uploader
- States: idle (dashed border), drag-over (indigo border + scale + bg tint), uploading (progress bar), error
- Max file size display, PDF-only validation messaging
- Animated cloud-upload icon using Framer Motion
- Keyboard-focusable, aria-describedby for instructions

### SkeletonLoader

- Animated shimmer (CSS `shimmer` keyframe, gradient sweep)
- Variants: card, row, text, avatar, stat-card

### StatCard

- Icon, label, value (large bold number), trend indicator (+/- % with arrow icon)
- Framer Motion: count-up animation for numbers on mount
- Hover: slight lift (translateY(-2px) + shadow-elevated)

### PageHeader

- Title (h1), subtitle, breadcrumbs (if nested), right-slot for CTA buttons
- Subtle bottom border or divider

### EmptyState

- Centered: icon (large, gray-300), heading, sub-text, optional CTA button
- Contextual icons: FileText (no claims), Upload (no documents), Users (no officers)

### AttemptTimeline

- Vertical timeline: attempt number, date, status (Pass/Fail badge), risk score chip
- Connecting line between nodes (red for failed attempt, green for passed)
- Framer Motion: stagger animation on mount (0.1s per node)

---

## 6. NAVIGATION & LAYOUT STRUCTURE

### Layout Pattern

Use **sidebar + header** layout for all authenticated panels:

```
[SIDEBAR 240px dark] | [CONTENT AREA]
                       [HEADER sticky white]
                       [PAGE CONTENT gray-50]
```

### Sidebar Design

- Background: `linear-gradient(180deg, #0f172a 0%, #1e293b 100%)`
- Logo area: ClaimGuard wordmark + shield icon, white text
- Nav items: icon + label, `text-gray-400` default, `text-white bg-white/10 rounded-lg` active, left-border `4px solid #6366f1` on active
- Hover: `bg-white/5` transition
- Role badge at bottom: small indigo chip ("Claim Officer" / "Hospital Admin")
- User info at bottom: avatar circle, name, email truncated
- Collapse button (desktop): ChevronLeft icon -> icon-only mode with tooltips
- Mobile: sidebar converts to slide-in drawer (Framer Motion AnimatePresence)

### Header Design

- Background: `rgba(255,255,255,0.95)` + `backdrop-blur-sm`, `border-b border-gray-200`
- Left: Breadcrumbs (Home > Section > Page) with ChevronRight separator
- Right: Notification bell (red dot badge for unread), user avatar dropdown (Profile, Logout)

---
