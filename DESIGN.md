---
name: simbot
description: A self-hosted Top Gear instrument that says plainly whether anything beats the equipped set.
colors:
  bg: "oklch(0.175 0.008 250)"
  bg-sunk: "oklch(0.145 0.008 250)"
  panel: "oklch(0.205 0.009 250)"
  panel-raised: "oklch(0.235 0.01 250)"
  line: "oklch(0.29 0.01 250)"
  line-strong: "oklch(0.38 0.012 250)"
  fg: "oklch(0.94 0.006 250)"
  fg-muted: "oklch(0.74 0.012 250)"
  fg-faint: "oklch(0.6 0.014 250)"
  action: "oklch(0.8 0.115 200)"
  action-strong: "oklch(0.86 0.12 200)"
  action-ink: "oklch(0.2 0.04 210)"
  action-wash: "oklch(0.8 0.115 200 / 0.12)"
  gain: "oklch(0.86 0.16 112)"
  gain-wash: "oklch(0.86 0.16 112 / 0.14)"
  loss: "oklch(0.73 0.15 30)"
  loss-wash: "oklch(0.73 0.15 30 / 0.14)"
  noise: "oklch(0.64 0.03 250)"
  noise-wash: "oklch(0.64 0.03 250 / 0.18)"
  q-poor: "#9d9d9d"
  q-common: "#f2f2f2"
  q-uncommon: "#1eff00"
  q-rare: "#0070dd"
  q-rare-text: "#3d9bff"
  q-epic: "#a335ee"
  q-epic-text: "#b862ff"
  q-legendary: "#ff8000"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "\"ss01\", \"cv11\""
  body-small:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.3
  figure:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\""
  data:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\""
rounded:
  xs: "4px"
  sm: "5px"
  md: "6px"
  button: "7px"
  lg: "8px"
  xl: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-ink}"
    typography: "{typography.title}"
    rounded: "{rounded.button}"
    padding: "0 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.action-strong}"
  button-primary-disabled:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.fg-faint}"
  button-secondary:
    textColor: "{colors.fg}"
    typography: "{typography.body-small}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-raised}"
  button-ghost:
    textColor: "{colors.fg-muted}"
    typography: "{typography.body-small}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  button-ghost-hover:
    textColor: "{colors.fg}"
  toggle-on:
    backgroundColor: "{colors.action-wash}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  segment-on:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    typography: "{typography.data}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "28px"
  paste-field:
    backgroundColor: "{colors.bg-sunk}"
    textColor: "{colors.fg}"
    typography: "{typography.data}"
    rounded: "{rounded.xl}"
    padding: "14px 16px"
  tag:
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.xs}"
    padding: "0 6px"
    height: "18px"
  tag-gain:
    backgroundColor: "{colors.gain-wash}"
    textColor: "{colors.gain}"
  tag-loss:
    backgroundColor: "{colors.loss-wash}"
    textColor: "{colors.loss}"
  tag-action:
    backgroundColor: "{colors.action-wash}"
    textColor: "{colors.action}"
  kbd:
    backgroundColor: "{colors.bg-sunk}"
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.xs}"
    height: "18px"
  command-column:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.xl}"
    padding: "20px"
  tray:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    width: "360px"
  slot-tile:
    rounded: "{rounded.md}"
    padding: "8px 10px"
  slot-tile-open:
    backgroundColor: "{colors.panel-raised}"
  rank-row:
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "42px"
  rank-row-selected:
    backgroundColor: "{colors.action-wash}"
  rank-row-noise:
    backgroundColor: "{colors.noise-wash}"
---

# Design System: simbot

## Overview

**Creative North Star: "The Instrument Beside the Game"**

simbot is a precise instrument that sits next to World of Warcraft, alt-tabbed on a desktop after a loot drop. It reads like an engineering tool rather than a fantasy one: tinted graphite surfaces, one teal voice for action, and numbers that are always set in tabular mono and always shown with their uncertainty. The Top Gear flow is built on the character sheet itself: six slots per side column, main hand bottom centre, and a command column in the middle that changes job from setup to run to verdict while the sheet stays put.

Density is high and calm. Type is small (13px body, 12.5px for most secondary copy), hierarchy comes from weight, tone and position instead of size jumps, and surfaces separate by one tonal step and a hairline, not by shadow. The anchors are a streaming build log, trace rows on a shared scale, and resizable panels. The system refuses the category default of a gold or neon WoW tool with ornamental frames.

WoW itself appears only as data: item quality colours on item names and icon borders, and one earned moment of spectacle, where changed items in the winning set glow in their own quality colour.

**Key Characteristics:**
- Dark first; light is a translation of the same roles, not a separate design.
- Four semantic roles (action, gain, loss, noise) on cool graphite neutrals.
- Quality colours are data, never chrome.
- Every number is tabular mono; every delta carries its error.
- The character sheet is the layout; panels open beside it inline, not in modals.

## Colors

Cool graphite (hue 250, chroma under 0.015) carries everything; four roles carry meaning; quality colours carry game data.

### Primary
- **Instrument Teal** (`action`): the only action colour. Primary buttons, focus rings, selected toggles, checked boxes, caret, active progress fill, the resize handle on hover, and "in play" markers during a run. `action-strong` is its hover; `action-ink` is the text on it; `action-wash` fills selected rows and pressed toggles.

### Secondary
- **Gain Lime-Amber** (`gain`): a positive delta that clears its error. Deliberately yellower than WoW's uncommon green so a win is never confused with an item quality. `gain-wash` backs gain tags.

### Tertiary
- **Loss Coral** (`loss`): negative deltas, blocking issues, parse errors, culled rows, stopped stages, destructive confirmation. `loss-wash` backs issue callouts and loss tags.
- **Noise Slate** (`noise`): results that cannot be told apart from #1 or from zero. A desaturated graphite, so an indistinguishable result reads as neither good nor bad. `noise-wash` tints the noise group in the ranking.

### Neutral
- **Graphite Ground** (`bg`): page background.
- **Sunk Graphite** (`bg-sunk`): wells: paste field, log, keyboard keys, icon backing.
- **Panel Graphite** (`panel`): trays, command column (at 60%), table heads, hover fill.
- **Raised Graphite** (`panel-raised`): open slot, active step, selected segment, hover inside panels, disabled primary.
- **Hairline** (`line`) and **Strong Hairline** (`line-strong`): borders and dividers; strong for secondary button outlines, unchecked boxes, the zero line on delta bars.
- **Ink** (`fg`), **Muted Ink** (`fg-muted`), **Faint Ink** (`fg-faint`): primary text, secondary text, labels and metadata.

### Quality (data only)
- `q-poor`, `q-common`, `q-uncommon`, `q-rare`, `q-epic`, `q-legendary` are WoW's own hex values, kept pure in dark. `q-rare-text` and `q-epic-text` are lifted variants for item-name text, because the pure hues are too dark to read as text on graphite. In light mode every quality colour is darkened just enough to read on a light ground.

### Named Rules
**The Data Not Chrome Rule.** Quality colours appear only on item names, icon borders and the item glow. Never on buttons, headings, backgrounds or any UI state.

**The Noise Is Not a Win Rule.** A delta whose magnitude is below its error is drawn in noise slate, never gain or loss. The tone is decided by the numbers, not by the sign.

**The One Voice Rule.** Teal is the only interactive colour. Gain and loss never become button fills; the single exception is the confirm step of Discard, which fills with loss.

## Typography

**Display Font:** Geist (with ui-sans-serif, system-ui)
**Label/Mono Font:** Geist Mono (with ui-monospace, SFMono-Regular), loaded from Google Fonts at 400 to 700 and 400 to 600.

**Character:** Geist sets the plain, engineered voice of the copy; Geist Mono sets every figure, id, ilvl, duration and log line in tabular numerals so columns and live counters never jitter. Body runs with stylistic sets `ss01` and `cv11`.

### Hierarchy
- **Display** (600, 24px, tight, -0.015em): the single page title on the paste step.
- **Headline** (600, 20px, -0.01em): the character name in the command column and the verdict headline. Balanced wrapping on the verdict.
- **Title** (600, 14px): tray, table and ranking headers. The run status heading sits at 17px as a local exception.
- **Body** (400, 13px, 1.45): item names in slots, descriptions, settings lines. Verdict detail caps at 62ch. The document base is 14px.
- **Body Small** (400, 12.5px): the workhorse for secondary copy, buttons in panels, notices and table cells.
- **Label** (400, 11.5px, faint): slot names, stat lines, meta under items. Sentence case, no tracking, no uppercase.
- **Figure** (mono 600, 26 to 28px, 1, -0.02em): the combination count beside Run and the selected combination's delta on the doll. The only large type in the system.
- **Data** (mono 400, 12.5px, -0.01em, tabular): every number. Log lines drop to 11.5px at 1.65 line height; ilvl badges and scale ticks to 10 to 10.5px.

### Named Rules
**The Tabular Rule.** Every numeral that can change or be compared is Geist Mono with tabular figures. No proportional digits in data.

**The Weight Not Size Rule.** Hierarchy steps by weight (400, 500 for item names, 600 for headings) and ink tone, with size jumps reserved for the one headline and one figure per view.

## Layout

The character sheet is the grid. On desktop it is a flex row: a left slot column (248px in setup and run, 220px in results) holding head, neck, shoulder, back, chest, wrist; an optional inline tray (360px) opening beside the column it belongs to; a flexible centre holding the command column with the main hand tile centred below it (max 320px); and the mirrored right column holding hands, waist, legs, feet, finger, trinket. Right-column tiles mirror: icon on the outer edge, text facing the centre. Arrow keys move across the sheet in that geometry.

Main content caps at 1440px with 16px side padding (24px from md). The top bar is sticky, 56px, with the product name, the character, a slash-separated step trail and the SimC version.

Results split into two resizable panels (default 58/42, minimums 560px and 420px, layout persisted): the re-dressed doll with verdict and stage table on the left, the virtualized ranking (46px row pitch) on the right, divided by a 1px hairline that turns teal on hover, focus and drag.

Below 768px the sheet collapses to a two-column slot grid with main hand spanning both, the tray and command column stack underneath, and results order becomes verdict, ranking, doll, stages.

Spacing runs on a 4px base: 4 and 8 inside controls, 12 between related items, 16 between sheet regions, 20 inside the command column, 24 between results sections.

## Elevation & Depth

Flat by default. Depth comes from tonal steps (sunk, ground, panel, raised) and hairlines. One shadow exists, `shadow-pop`, and it is used only on the inline tray, the one surface that sits in front of the sheet. The item glow is a data signal, not elevation.

### Shadow Vocabulary
- **Pop** (`box-shadow: 0 8px 24px -8px oklch(0.05 0.01 250 / 0.7), 0 2px 6px -2px oklch(0.05 0.01 250 / 0.5)`; lighter in light mode): the slot tray.
- **Quality Glow** (`box-shadow: 0 0 0 1px Q, 0 6px 18px -4px color-mix(in oklch, Q 70%, transparent), 0 0 28px -6px color-mix(in oklch, Q 55%, transparent)` where Q is the item's quality colour): changed items in the displayed combination, lit on mount over 250ms.

### Named Rules
**The One Glow Rule.** Only an item that changed in the displayed combination glows, and only in its own quality colour. Nothing else in the interface glows.

## Shapes

Small, tight radii that grow with the container: 4px for tags, keys and checkboxes; 5px for item icons, segmented options, toggles and small inputs; 6px for slot tiles, rank rows and panel buttons; 7px for primary buttons; 8px for trays, callouts and tables; 10px for the command column and paste field. Progress bars are 3px pill tracks. Borders are 1px hairlines; state rings are 1px at partial opacity (teal at 45 to 50% for open or selected, coral at 45% for a blocking issue). Item icons are square, bordered in their quality colour.

## Components

### Buttons
- **Shape:** 7px for the primary, 6px for panel buttons, 5px for compact ones.
- **Primary:** teal fill, dark teal ink, semibold; 40px tall with 20px padding for Run Top Gear (with a filled play icon), 36px for Read string. Hover steps to `action-strong` over 150ms. Disabled drops to raised graphite with faint ink.
- **Secondary:** 1px strong hairline, no fill, medium weight; hover fills raised graphite. Stop and keep results, Edit and re-run, Retry.
- **Ghost:** muted text only; hover to ink, or to loss for a destructive ghost (Discard).
- **Destructive confirm:** Discard asks inline ("Throw away every result?") and only then shows a loss-filled button. No dialog.

### Chips
- **Tag:** 18px, 4px radius, 11px medium, 1px border. Neutral (hairline, muted), action, gain, loss and noise tones pair a 40% border with the role's wash.
- **Toggle (talent loadouts):** 5px, bordered; pressed is teal border at 50% on `action-wash`. The last remaining loadout is locked on.
- **Segmented (fight style, precision):** selected is raised graphite with a strong-hairline ring; others muted text.

### Cards / Containers
- **Command column:** 10px, hairline border, panel at 60%, 20px padding, children spaced 20px, footer divided by a hairline carrying count, estimate and Run.
- **Tray:** 8px, hairline, panel, pop shadow, header row with count and All / None / close, Escape closes and returns focus to the slot.
- **Callout:** 8px, coral border at 35% on `loss-wash`, with an alert icon. Used for unknown item ids and SimC failures.
- **Log:** sunk well, 8px, mono 11.5px, timestamps right-aligned faint, auto-scrolls.

### Inputs / Fields
- **Paste field:** sunk well, 10px, mono 12.5px, 14 by 16px padding, hairline border that turns teal on focus and coral at 60% when invalid.
- **Settings inputs:** 28px, 5px, panel fill, mono, teal border on focus.
- **Focus (global):** 2px teal outline, 2px offset, 3px radius. Caret is teal.

### Navigation
- **Step trail:** 12.5px items separated by strong-hairline slashes; current step on raised graphite, past muted, future faint. Hidden below md.

### Item Icon (signature)
Square WoW icon at 24, 36, 48 or 64px, 5px radius, 1px border in quality colour on a sunk backing, with a mono ilvl badge bottom right. Dim state is 45% opacity and greyscale for unusable or replaced items. Falls back through two CDNs to a drawn placeholder.

### Slot Tile (signature)
Icon plus a text stack (faint slot label, item name in quality text colour, muted meta). 6px, 8 by 10px padding, hover to panel, open is raised with a teal ring. A coral dot beside the label marks a slot that blocks Run. Quiet state dims the name to 60% for slots not in play.

### Delta Bar (signature)
The ranking's shared-scale bar: a strong-hairline zero line, the delta bar at 55% height (90% opacity for gain or loss, 55% for noise), the error drawn as a band with whiskers at 18% of the tone, and a 2px ink dot at the mean. Every row in a ranking uses the same min and max.

### Rank Row
42px grid (34px rank, bar and changed-item icons, 92px delta with error beneath). Selected is `action-wash` with a teal ring; the noise group is tinted `noise-wash`. The equipped set is pinned above the list. j and k move the selection.

### Stage Ladder
Numbered stages with iterations, a 3px progress track filling teal (done fades to ink at 35%, stopped turns coral), and "entered → kept" counts in mono.

## Do's and Don'ts

### Do:
- **Do** draw every delta with its error, and tone it noise slate when the magnitude is below the error.
- **Do** set every figure in Geist Mono with tabular numerals.
- **Do** keep quality colours pure on item names and icon borders, using the `-text` variants for rare and epic names.
- **Do** open detail beside the sheet as an inline tray; confirm destructive actions inline.
- **Do** separate surfaces by one tonal step and a 1px hairline before reaching for a shadow.
- **Do** author dark first and translate light from the same role names.

### Don't:
- **Don't** use quality colours, gold or fantasy framing for chrome.
- **Don't** use side-stripe borders, gradient text or decorative glass.
- **Don't** make a hero-metric template or grids of identical cards.
- **Don't** reach for a modal as the first instinct.
- **Don't** add eyebrow kickers above headings.
- **Don't** use em dashes in UI copy.
- **Don't** glow anything except changed items in the displayed combination.
- **Don't** use uncommon green for gain.
