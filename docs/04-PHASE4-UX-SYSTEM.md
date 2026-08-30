# Phase 4 — UX and UI System

**PrompTED · TED AI · UX System Version 1.0 · June 2026**

> Every UX decision derives from the governing doctrine: "The competitor is confusion, not ChatGPT." The interface is calm, warm, trustworthy, and predictable. It is used by people who are often stressed or busy.

---

## 4.1 Design Principles

1. **One primary goal per screen.** If a screen has more than one "main" action, redesign it.
2. **The user is never lost.** At every point: stage, progress, what's done, what remains, what's next.
3. **TED leads.** No template picking, no workflow choices, no bureaucracy to understand.
4. **Progress is visible** for any multi-step task: bundle progress, workspace approval counter.
5. **Every screen reduces anxiety.** Warm tone, plain language, reassurance on errors.
6. **Hide the machinery.** No AI names, no model names, no technical language.
7. **Finish the job.** The interface pushes toward completion, not generation.
8. **Accessibility is not optional.** 17pt, AA contrast, VoiceOver, reduced motion — always.

### The feel

Closer to Notion + Grammarly than to a chatbot. Closer to a calm, professional assistant than to a developer tool. The kind of app a busy small-business owner reaches for when they need something done — not to play with AI.

---

## 4.2 Colour Palette

### Primary palette (default)

| Token | Hex | Use |
|-------|-----|-----|
| `--cream` | `#F6F0E6` | Page background |
| `--cream-deep` | `#EFE5D4` | Card backgrounds, sections |
| `--card` | `#FFFDF8` | Elevated card surfaces |
| `--coral` | `#DC5430` | Primary action, TED accent, CTA |
| `--coral-deep` | `#B83F22` | Coral hover state |
| `--charcoal` | `#26211C` | Primary text |
| `--charcoal-soft` | `#5E544A` | Secondary text |
| `--charcoal-muted` | `#8C7F74` | Placeholder, muted text |
| `--line` | `#DDD4C5` | Dividers, borders |
| `--line-soft` | `#EDE5D9` | Subtle dividers |
| `--teal` | `#2D9E9E` | Success, completed state |
| `--amber` | `#D97706` | Warning, in-progress |
| `--red-soft` | `#DC2626` | Error, danger action |
| `--white` | `#FFFFFF` | Input backgrounds, modals |

### Section status colours

| Status | Background token | Text token | Border |
|--------|-----------------|-----------|--------|
| Draft | `--cream-deep` | `--charcoal-soft` | `--line` |
| Edited | Amber `#FEF3C7` | `#92400E` | Amber `#D97706` |
| Approved | Teal `#D1FAE5` | `#065F46` | Teal `#2D9E9E` |
| Locked | Charcoal `#E5E2DE` | `--charcoal` | `--charcoal-soft` |

### Alternative dark theme (for OLED / accessibility preference)

| Token | Hex | Use |
|-------|-----|-----|
| `--base` | `#16202E` | Page background |
| `--surface` | `#1E2530` | Card surface |
| `--accent` | `#DC5430` | Coral (same — warm on dark) |
| `--text-primary` | `#F1F5F9` | Body text |
| `--text-secondary` | `#94A3B8` | Secondary text |

The default (and recommended) theme is the cream/coral/charcoal warm identity. Dark mode is an accessibility/preference option, not the default.

---

## 4.3 Typography

| Token | Font | Size | Weight | Use |
|-------|------|------|--------|-----|
| `--display` | Nunito | 32–48pt | 700–800 | Headlines |
| `--heading-xl` | Nunito | 28pt | 700 | Section heading, modal title |
| `--heading-lg` | Nunito | 22pt | 700 | Card title |
| `--heading-md` | Nunito | 19pt | 600 | Section subheading |
| `--body-lg` | Nunito | 18pt | 400–500 | Primary body text (minimum for main content) |
| `--body-md` | Nunito | 17pt | 400 | Body text (floor) |
| `--body-sm` | Nunito | 15pt | 400 | Secondary info, captions |
| `--label` | Nunito | 14pt | 600 | Input labels, badges |
| `--caption` | Nunito | 13pt | 400 | Timestamps, footnotes |
| `--mono` | System monospace | 14pt | 400 | Code, IDs (rare) |

**Font loading:** Google Fonts: `Nunito:wght@400;500;600;700;800`. Preconnect in `<head>`. Fallback: `system-ui, -apple-system, sans-serif`.

**Line height:** `1.6` for body text. `1.3` for headings. `1.8` for documents (readability).

**17pt floor is non-negotiable.** Every body text element must be ≥17pt. Labels may be 14pt but are not primary reading content.

---

## 4.4 Layout System

### Spacing scale (8pt grid)

| Token | Value | Use |
|-------|-------|-----|
| `--space-1` | 4pt | Icon padding, tight gaps |
| `--space-2` | 8pt | Internal component padding |
| `--space-3` | 12pt | Small gaps between related elements |
| `--space-4` | 16pt | Standard gap |
| `--space-5` | 20pt | Component internal padding |
| `--space-6` | 24pt | Section gap |
| `--space-8` | 32pt | Large section gap |
| `--space-10` | 40pt | Screen section gap |
| `--space-12` | 48pt | Hero gap |

### Breakpoints

| Name | Min width | Layout |
|------|----------|--------|
| Mobile | 0 | Single column, stacked |
| Tablet | 768px | Two column (side nav + content) |
| Desktop | 1024px | Three-pane (workspace) |
| Wide | 1440px | Max content width 1180px centred |

### Border radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | 8pt | Chips, tags |
| `--radius-md` | 12pt | Cards, buttons |
| `--radius-lg` | 16pt | Modals, panels |
| `--radius-xl` | 24pt | Large cards |
| `--radius-pill` | 9999px | Pill buttons, badges |

### Shadow

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-sm` | `0 1px 4px rgba(38,33,28,.06)` | Subtle card lift |
| `--shadow-md` | `0 4px 16px rgba(38,33,28,.10)` | Cards, modals |
| `--shadow-lg` | `0 8px 32px rgba(38,33,28,.14)` | Focused/hover |

---

## 4.5 Component Library

### Button

```
Primary:   background: coral, text: white, border-radius: pill
           hover: coral-deep, translateY(-2px), shadow-lg
           focus: 3px coral outline (offset 3px)
           disabled: 40% opacity

Ghost:     background: transparent, border: 2px charcoal, text: charcoal
           hover: fill charcoal, text: white

Danger:    background: transparent, border: 2px red-soft, text: red-soft
           hover: fill red-soft, text: white

Text:      no background, no border, text: charcoal
           hover: underline

Sizes: sm (14pt, pad 0.6em 1em) | md (17pt, pad 0.8em 1.4em) | lg (18pt, pad 1em 1.8em)
```

All buttons: min touch target 44×44pt. Loading state: spinner replaces icon/text. Never disable without explanation.

### Input

```
Background: white
Border: 1.5px solid line
Border-radius: radius-md (12pt)
Font: body-md (17pt)
Padding: 12pt 16pt
Focus: coral border 2px, subtle glow
Error: red-soft border, error message below
Label: above input, body-sm, charcoal, 600 weight
Hint: below input, caption, charcoal-muted
```

Date fields: native date picker (DD/MM/YYYY on iOS, date input on web). Never free text for dates.

Money fields: number input with `$` prefix, formatted as `$#,##0.00`.

### Badge (status chip)

```
Pill shape (radius-pill)
Colour + icon + text (never colour alone)
Font: label (14pt, 600)

Draft:    cream-deep bg, charcoal-soft text, clock icon
Edited:   amber-100 bg, amber-800 text, pencil icon
Approved: teal-100 bg, teal-800 text, checkmark icon
Locked:   charcoal-100 bg, charcoal text, lock icon
```

### Section card

```
Background: card
Border: 1px line-soft
Border-radius: radius-lg
Padding: 16pt 20pt
Shadow: shadow-sm on hover

Left: drag handle (⠿, grab cursor) + status badge + section name (heading-md)
Right: action buttons (Approve, Edit with TED)
Body: first 2 lines of content (truncated, body-sm)

Reorder: the drag handle (⠿) enables drag-and-drop reordering in the section
list. Keyboard equivalent: focus the handle, then ↑/↓ (or move-up/move-down
buttons in the overflow menu) moves the section. While dragging, a coral
insertion line shows the drop position. Locked sections show no handle.
```

### Recommendation card (primary + variants)

```
Primary card:
  Background: card
  Left accent: 3px coral left border
  Top: "TED recommends" label (label, coral)
  Title: document name (heading-lg)
  Use-case: body-md
  Benefits: bulleted list (body-sm)
  CTA: "Use this" primary button

Variant card:
  Background: cream-deep
  Left accent: 3px line left border
  Top: "Alternative" label (label, charcoal-muted)
  Title: document name (heading-md)
  Use-case: body-sm
  CTA: "Use this instead" ghost button

Three cards in a horizontal scroll on mobile, side-by-side on desktop.
```

### Checklist item

```
Checkbox: 22×22pt, custom (coral fill when done, charcoal border undone)
Text: body-md (strikethrough + muted when done)
Deadline chip: pill badge, amber if <7 days, teal if >7 days, body-sm
Days remaining: caption, muted
Expand chevron: opens reason section (body-sm, charcoal-muted, italic)
Reminder bell: icon button, coral if active
```

---

## 4.6 Navigation Structure

### Mobile (bottom tabs, max 4)

```
[Home] [Library] [Business*] [Settings]

* Business tab: visible only on Business plan. Hidden for individual users (3 tabs).
```

Tab icons: Tabler icon set. Active: coral. Inactive: charcoal-muted. Tab labels: 12pt, charcoal-muted.

### Web (side navigation, collapsible on tablet)

```
Sidebar (240px, cream-deep background):
  [Logo: PrompTED]
  [Home]
  [Library]
  [Business] (business plan only)
  [Settings]
  ---
  [New outcome] button (coral, bottom of sidebar)
```

On mobile web: bottom tab navigation (same as native).

### Back navigation

All screens have a back button. No screen is orphaned. The outline:
- Home → (new outcome) → Summary card → Bundle/documents → Workspace → (back to bundle/documents)
- Home → (existing outcome) → Workspace (resumed)
- Library → any outcome → Workspace

---

## 4.7 Chat Home Screen Layout

```
┌─────────────────────────────────────────────────────┐
│  [Logo: PrompTED]               [Auth: Sign in]     │  ← topbar
├─────────────────────────────────────────────────────┤
│                                                      │
│           What are you trying to achieve?            │  ← display (32pt, Nunito 700, charcoal)
│      Tell TED what's going on — TED works            │  ← body-md, charcoal-soft
│            out what you need.                        │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  Ask TED...                              📎  │    │  ← main input (Textarea, 17pt, body-md)
│  │                                          📷  │    │    📎 = attach file, 📷 = camera/photo
│  └─────────────────────────────────────────────┘    │    + whole input area is a drag-and-drop dropzone
│  [Send button: coral, pill, "Ask TED →"]             │
│                                                      │
│  Drag-over state: input area shows a dashed coral    │  ← "Drop to add as context"
│  border + overlay; 📎 is the keyboard/SR equivalent  │
│                                                      │
│  ─── Examples ──────────────────────────────────── │  ← caption, charcoal-muted
│  [I need a job]  [Write a policy]  [I'm applying]   │  ← example chips (horizontal scroll)
│  [Onboard someone]  [Moving house]  [Browse ▾]       │
│                                                      │
│  ─── Jump back in ──────────────────────────────── │  ← shown for returning users only
│  [Recent outcome 1]  [Recent outcome 2]  [See all]   │  ← DocumentCard strip (horizontal scroll)
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Empty state (first visit):** No "jump back in" section. Just the headline, input, and example chips.

**Mobile behaviour:** Input is full-width. Example chips scroll horizontally. The "jump back in" strip is above the keyboard on iOS.

**Attach flow:** Tapping 📎 opens file picker (PDF, Word, JPEG, PNG, HEIC). Tapping 📷 opens camera (iOS: PHPicker). Attached file shows as a chip below the input with a remove ×.

---

## 4.8 Master Workspace Layout

### Desktop (≥1024px) — three-pane

```
┌──────────────┬──────────────────────────────────┬──────────────┐
│ Section List │           Section Editor          │ Live Preview │
│   (240px)   │            (flex)                 │   (320px)   │
├──────────────┼──────────────────────────────────┼──────────────┤
│              │ [Section: Summary]                │  ┌─────────┐│
│ ⠿ ✓ Summary  │                                   │  │ LOGO    ││
│   Edited     │  This letter confirms the offer   │  │         ││
│              │  of employment for [Name]...      │  │ Offer   ││
│ ⠿ ○ Duties   │                                   │  │ Letter  ││
│   Draft      │  [Manual edit area]               │  │         ││
│              │                                   │  │ [text]  ││
│ ○ Terms      │  [Edit with TED ▾]                │  │         ││
│   Draft      │    ○ Improve  ○ Shorten           │  │ [text]  ││
│              │    ○ Expand   ○ Change tone        │  └─────────┘│
│ ○ Signature  │    ○ Add detail                   │             │
│   Draft      │                                   │ [Brand kit] │
├──────────────┤                                   │             │
│ 1 of 4       │                                   │             │
│ sections     │                                   │             │
│ approved     │                                   │             │
│              │                                   │             │
│ [Export ▾]   │                                   │             │
│ disabled     │                                   │             │
└──────────────┴──────────────────────────────────┴──────────────┘
```

### Mobile — stacked / step flow

```
Step 1: Section list
┌─────────────────────────────────────────────────┐
│ ← Offer Letter                     1 of 4 ✓    │  ← header
├─────────────────────────────────────────────────┤
│ [Summary]           [Edited ✏]   [Approve ✓]   │
│ This letter confirms the offer...               │
├─────────────────────────────────────────────────┤
│ [Duties             [Draft]      [Approve ✓]   │
│ The role requires...                            │
├─────────────────────────────────────────────────┤
│ ...                                             │
├─────────────────────────────────────────────────┤
│          [Export (approve all first)]           │  ← bottom, disabled until all approved
└─────────────────────────────────────────────────┘

Step 2: Section editor (full screen)
┌─────────────────────────────────────────────────┐
│ ← Summary                        [Approve ✓]   │
├─────────────────────────────────────────────────┤
│  [Rich text editor area — full height]          │
├─────────────────────────────────────────────────┤
│ [Edit with TED ▾]  [History ↺]  [Preview 👁]   │
└─────────────────────────────────────────────────┘
```

---

## 4.9 Document Editor Layout

The section editor (centre pane on desktop, full-screen on mobile):

```
Section name (heading-md, charcoal)
Status badge (Draft / Edited / Approved)

[Tiptap rich text editor]
  Toolbar (visible on desktop, hidden until selection on mobile):
    [Bold] [Italic] [H2] [H3] [Bullet list] [Numbered list]
  Content area: body-md (17pt), 1.8 line height, white background
  Border: 1px line, border-radius: radius-md

[Footer bar]
  Left: [Version history ↺]  (shows version count if >1)
  Centre: [Edit with TED ↓]  (expands action panel)
  Right: [Approve ✓] (disabled if content unchanged from draft)

[Edit with TED panel] (collapsible, appears below footer)
  [Improve]  [Shorten]  [Expand]  [Change tone]  [Add detail]
  Each button triggers streaming edit; result replaces section content
  "Undo" restores previous version from history
```

---

## 4.10 Project History Layout (Library)

```
┌─────────────────────────────────────────────────────┐
│  Library                          [Search 🔍]        │
├─────────────────────────────────────────────────────┤
│  [Recents]  [Saved]  [Your Templates]               │  ← tabs
├─────────────────────────────────────────────────────┤
│  ── What's due ─────────────────────────────────── │
│  📅 Register car seat — in 12 days                  │
│  📅 Book 20-week scan — in 18 days                  │
│                                                      │
│  ── Recent outcomes ────────────────────────────── │
│  ┌────────────────────────────────────────────────┐ │
│  │ [🏢 Business]  Workplace Policy                │ │  ← DocumentCard
│  │ [In progress ⟳]          Updated 2 hours ago  │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ [👔 Employment]  I need a job                  │ │
│  │ [Done ✓]                    Exported 2 Jun     │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ [🎓 Education]  Personal statement             │ │
│  │ [Draft ○]                   Started 1 Jun      │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**DocumentCard states:**
- Draft: cream-deep bg, clock icon, charcoal-muted text
- In progress: amber-50 bg, ↻ icon, amber-700 text
- Done: teal-50 bg, ✓ icon, teal-700 text

---

## 4.11 Settings Layout

```
┌─────────────────────────────────────────────────────┐
│  Settings                                           │
├─────────────────────────────────────────────────────┤
│  ── Your profile ─────────────────────────────────  │
│  [Avatar]  Name · Email · Phone       [Edit]        │
│                                                      │
│  ── Your style (Clari) ────────────────────────────  │
│  Reading level:  [Simple] [Moderate ✓] [Detailed]   │
│  Tone:           [Casual] [Professional ✓]          │
│                                                      │
│  ── Business ──────────────────────────────────────  │  (business plan only)
│  [Business name: Acme Co]              [Edit]        │
│  [Brand kit: logo, colours]            [Edit]        │
│  [Company voice]                       [Edit]        │
│                                                      │
│  ── Subscription ──────────────────────────────────  │
│  Plan: Pro ($20/mo)       [Manage / Upgrade]        │
│  Documents used: 12 of 20 this month                 │
│                                                      │
│  ── Accessibility ─────────────────────────────────  │
│  [Larger text toggle]  [Reduce motion toggle]       │
│                                                      │
│  ── Account ───────────────────────────────────────  │
│  [Privacy policy]  [Terms]  [Delete account]        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## 4.12 Empty States

### Home — first visit

```
[Warm illustration: TED chat bubble with "T"]

"What do you need to get done?"
TED can help you with employment, business, and education — or just describe what's on your plate.

[Example chip row]
```

### Library — no outcomes

```
[Illustration: empty folder, soft cream]

"Nothing here yet"
Start by asking TED for help — your finished documents and plans will appear here.

[Ask TED → button]
```

### Library — no due dates

No "What's due" section shown. The section only appears when checklist items with `due_date` exist.

### Workspace — sections not yet generated

```
[Progress animation: TED working]
"TED is preparing your document..."
```

---

## 4.13 Loading States

All loading states follow the rule: **no bare spinners**. Every wait shows contextual progress in TED's voice.

### Intent interpretation

```
[Subtle pulsing coral dot]
"TED is reading your situation..."
```

### Recommendation generation

```
[Animated TED bubble]
"TED is working out what you need..."
```

### Document drafting (streaming)

```
[Progress: "Preparing your Offer Letter..."]
[Section names appear as they start streaming]
[Each section shows a typing animation as text streams in]
```

### Export

```
[Coral progress bar, indeterminate]
"TED is creating your PDF..."
```

### Checklist research

```
"TED is researching the latest guidance..."
[Then: "Building your personalised checklist..."]
```

### Upload ingestion

```
"TED is reading your file..."
```

**Minimum display time for all loading states:** 400ms (to avoid flash of empty content).

---

## 4.14 Error States

All errors: plain English, TED's voice, warm reassurance, clear retry.

### General error (network / AI outage)

```
[Soft coral icon — not a red X]

"TED hit a small snag"
Nothing's been lost. Let's try again.

[Try again →]
```

### Upload error (unsupported format / too large)

```
"TED couldn't read that file"
Try a PDF or Word document, or just type your details instead.

[Try a different file]  [Type instead]
```

### Export error

```
"We couldn't create your file just now"
Your work is saved and nothing is lost. Try again in a moment.

[Try again →]
```

### Session expired

```
"You've been gone a while"
Sign back in to pick up where you left off — your work is saved.

[Sign in →]
```

### Over plan limit (paywall)

```
"You've reached your [Free / Pro] document limit"
Upgrade to [Pro / Premium] to keep going.

[See plans]  [Not now]
```

This is the paywall — it appears only after the user has already seen a completed draft (FR-013). Never on first use.

---

## 4.15 Mobile Responsive Behaviour

### Home screen

- Full-width input; example chips horizontal-scroll strip
- "Jump back in" collapses to horizontal card strip (3 visible, "See all" button)
- Large headline scales down to 26pt on small screens (≤375px width)

### Workspace (mobile)

- Three panes become three tabs: [Sections] [Editor] [Preview]
- Default tab: Sections (section list with approval)
- Tapping a section card → Editor tab auto-opens
- Preview tab shows full document render (scrollable)
- "Edit with TED" panel slides up from bottom (sheet modal)
- Export button is pinned to the bottom of the Sections tab

### Recommendation card (mobile)

- Three cards in a horizontal scroll: primary fills 85% width, variants peek at 15%
- User swipes to see variants; primary has "TED recommends" label

### Library (mobile)

- Full-width DocumentCards
- "What's due" section appears as a collapsible row above the card list
- Tabs (Recents/Saved/Templates) are pill tabs, not underline tabs, for larger tap targets

### Settings (mobile)

- Full-width list with section headers
- Each section expands/collapses on tap (accordion)
- Brand kit editor: modal sheet on mobile

### Keyboard avoidance

- All input screens (`KeyboardAvoidingView` on native; CSS `env(keyboard-inset-height)` on web)
- Input always visible above keyboard
- Submit button visible above keyboard

### Touch targets

- All interactive elements ≥44×44pt
- Section cards ≥56pt height
- Tab bar items ≥48pt height
