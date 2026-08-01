# Redesign implementation plan

The reference design lives at `design/squeal-sql-editor.html`. It is a
self-unpacking bundle: open it in a browser to see it live. The readable source
is the `<script type="__bundler/template">` block — base64/gzip assets in the
`__bundler/manifest` block are JetBrains Mono woff2 subsets plus the React UMD
builds.

To read the markup without a browser, decode the template:

```js
const html = fs.readFileSync('design/squeal-sql-editor.html', 'utf8')
const template = JSON.parse(
  html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]
)
```

The design ships light and dark variants of the same token set, a
comfortable/compact density switch, and four accent options. **We are taking
light and dark only** — density is fixed at comfortable and the accent at
`#5b7699`; the compact metrics and the three alternate swatches are out of
scope.

---

## What the design changes, at a glance

| Area           | Today                                                              | Design                                                                              |
| -------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Palette        | Catppuccin Latte/Frappé, HSL, `base`/`mantle`/`surface-N`/`mauve`  | Neutral OKLCH set, `bg`/`panel`/`panel2`/`border`/`text{,2,3}`, single `--accent`     |
| Fonts          | Geist Variable + Geist Mono + Bricolage display                    | System UI sans + JetBrains Mono, no display face                                      |
| Title bar      | 28px                                                                | 40px, with a theme-toggle button                                                      |
| Sidebar        | Fixed `w-80`, traces button in the footer                          | Resizable 200–380px (default 264), worksheets capped at 44% height, no footer         |
| Open worksheet | One at a time                                                       | **Tab bar** with several open worksheets and close buttons                            |
| Toolbar        | Icon-only Run + shadcn `Select`                                     | Labelled Run with a `⌘↵` badge, searchable connection popover                         |
| Editor         | CodeMirror, Catppuccin highlighting                                | Same layout, new syntax palette, floating **Format query** button                     |
| Results        | Overlay sheet, only visible after a run                            | Docked pane, always visible, resizable 120–620 (default 320), idle empty state        |
| Results header | Row count + timing on the left                                      | **Results / Messages** tabs on the left, `100 rows · 2,373 ms · 4 min ago` on the right |
| Errors         | Generic `<pre>`                                                     | Bordered error card with title/detail split and `Failed after N ms`                   |
| Status bar     | None                                                                | **New**: health dot, connection, server version, run summary, `Ln 7, Col 58`, `UTF-8` |

New functionality needed to support the design: worksheet tabs, a message log, a
server-version probe, a connection health signal, cursor line/column reporting,
SQL formatting, and persisted UI state (sidebar width, results height, open
tabs).

---

## Decisions (settled)

1. **Tab persistence — `localStorage`.** `{ openWorksheetIds,
   activeWorksheetId }` under `ui:tabs:v1`, rehydrated on boot. No schema
   migration, no contract change; tabs are a view concern and the store already
   persists theme this way. See task 3.2.
2. **Result pagination — virtualize, drop the pager.** One continuous scroll as
   designed, with the row count in the results header. Adds
   `@tanstack/react-virtual` so the 10,000-row cap (`maxResultRows`) scrolls
   without janking. See task 6.6.
3. **Density and accent — comfortable and `#5b7699` only.** No compact
   variant, no alternate swatches, no preferences UI. `--accent` stays a single
   token because `--accent-btn`, `--accent-soft`, and `--sel` all derive from it
   via relative color and `color-mix`, but it holds one fixed value. The
   `--row-h`/`--item-h`/`--code-size`/`--code-lh` tokens keep their comfortable
   values only. See tasks 0.1 and 0.2.
4. **Body font — the system UI stack.** Drops
   `@fontsource-variable/geist`, `@fontsource/geist-mono`, and
   `@fontsource-variable/bricolage-grotesque`; adds
   `@fontsource/jetbrains-mono`. The Bricolage wordmark in the title bar and
   getting-started screen becomes plain system text. See task 0.3.
5. **Connection health dot — derived from the last query.** `--ok` when the
   last run on the worksheet succeeded, `--text3` when nothing has run, `--err`
   when it failed. No poller, no idle connections held open. Known limitation:
   the dot goes stale between runs and won't catch a connection that dies while
   idle — a `title` tooltip spells out what the state actually means. See task
   7.2.

---

## Phase 0 — Design tokens and typography

### 0.1 Add the new token set

**Files:** `src/app/styles/themes/` (new `squeal-light.css`, `squeal-dark.css`),
`src/app/index.css`

Port the tokens verbatim from the design's second `<style>` block. Light:

```
--bg oklch(96.2% .004 250)   --panel oklch(99% .002 250)   --panel2 oklch(97.6% .003 250)
--border oklch(89.5% .006 250)   --border2 oklch(93.5% .004 250)
--text oklch(28% .015 260)   --text2 oklch(47% .015 260)   --text3 oklch(63% .012 260)
--accent #5b7699
--accent-btn oklch(from var(--accent) 50% c h)
--accent-soft color-mix(in oklab, var(--accent) 10%, var(--panel))
--hover oklch(94.2% .005 250)   --sel color-mix(in oklab, var(--accent) 13%, var(--bg))
--syn-kw oklch(47% .11 262)   --syn-str oklch(51% .1 152)   --syn-num oklch(54% .12 45)
--syn-fn oklch(51% .11 310)   --syn-op oklch(55% .03 260)
--err oklch(52% .15 25)   --err-bg oklch(96.5% .02 25)   --err-border oklch(85% .06 25)
--ok oklch(62% .13 152)
```

Dark:

```
--bg oklch(20.5% .018 268)   --panel oklch(24.5% .018 268)   --panel2 oklch(22.5% .018 268)
--border oklch(37% .025 268)   --border2 oklch(31.5% .022 268)
--text oklch(90% .012 268)   --text2 oklch(79% .018 268)   --text3 oklch(64% .022 268)
--accent-btn oklch(from var(--accent) 58% calc(c * 1.35) h)
--accent-soft color-mix(in oklab, var(--accent) 24%, var(--panel))
--hover oklch(30% .022 268)   --sel color-mix(in oklab, var(--accent) 32%, var(--bg))
--syn-kw oklch(76% .1 262)   --syn-str oklch(77% .1 152)   --syn-num oklch(79% .11 50)
--syn-fn oklch(78% .1 310)   --syn-op oklch(66% .03 265)
--err oklch(74% .13 25)   --err-bg oklch(28% .04 25)   --err-border oklch(42% .07 25)
--ok oklch(72% .12 152)
```

Keep the existing `[data-theme][data-mode]` selector mechanism rather than the
design's `body.dark` — `theme-bootstrap.ts` already applies it before first
paint, and switching to a body class would reintroduce a flash. Name the theme
`squeal` so `data-theme='squeal'` replaces `data-theme='catppuccin'`.

**Done when:** both files are imported, and toggling `data-mode` on
`<html>` in devtools swaps every token.

### 0.2 Add the layout/metric tokens

**Files:** the same theme files

```
--row-h 34px   --item-h 30px   --code-size 12.5px   --code-lh 21px
--mono 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace
```

The design's `body.compact` override is **not** implemented (decision 3). Still
route every height and code metric through these tokens rather than hardcoding
34/30/12.5/21 at each call site — that is what makes a density switch a
one-block change if it's ever wanted, and it costs nothing now.

### 0.3 Install JetBrains Mono, retire the old faces

**Files:** `package.json`, `src/app/index.css`

Add `@fontsource/jetbrains-mono` (weights 400/500/600 — the design uses all
three) and import it. Remove `@fontsource-variable/geist`,
`@fontsource/geist-mono`, and `@fontsource-variable/bricolage-grotesque`, plus
the `--font-display` token and every `font-display` class (`TitleBar.tsx`,
`GettingStartedScreen.tsx`).

Set `--font-sans` to the design's stack:
`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`, and
`--font-mono` to `var(--mono)`.

### 0.4 Remap the Tailwind theme

**Files:** `src/app/index.css`

Replace the `@theme inline` block. Suggested mapping, applied across every
component in the phases below:

| Old                  | New            |
| -------------------- | -------------- |
| `bg-base`            | `bg-panel`     |
| `bg-mantle`          | `bg-panel2`    |
| `bg-crust`           | `bg-bg`        |
| `bg-surface-0`, `bg-surface-1` (hover) | `bg-hover` |
| `border-surface-0`   | `border-border`|
| `border-surface-1`   | `border-border2` |
| `text-text`          | `text-text`    |
| `text-subtext-0`     | `text-text2`   |
| `text-overlay-0/1/2` | `text-text3`   |
| `text-mauve`, `bg-mauve/10` | `text-accent`, `bg-sel` |
| `text-red`           | `text-err`     |
| `text-green`         | `text-ok`      |

Radii in the design are 4/5/6/8px — keep `--radius-sm: 0.375rem` (6px) as the
default and add explicit `rounded-[4px]`/`rounded-[5px]`/`rounded-lg` where the
design calls for them.

**Done when:** `rg 'mauve|surface-|subtext-|mantle|crust' src/app` returns
nothing.

### 0.5 Scrollbars

**Files:** `src/app/index.css`

Widen to 10px, thumb `var(--border)`, radius 5, `2px solid transparent` border
with `background-clip: padding-box`, transparent track. Drop the
`scrollbar-color` / `overlay-1` remnants.

---

## Phase 1 — App shell

### 1.1 Title bar at 40px

**Files:** `src/app/components/TitleBar.tsx`, `src/main.ts`

- Height 40px (`h-10`), `bg-panel2`, `border-b border-border`.
- Centered "Squeal", 13px, weight 600, `text-text2`, `tracking-[0.01em]`.
- Update `trafficLightPosition` in `src/main.ts:80` from `{ x: 12, y: 8 }` to
  `{ x: 12, y: 14 }` so the native macOS buttons centre in the taller bar.
- Keep the existing non-macOS window buttons; restyle them to the new tokens.

### 1.2 Theme toggle button

**Files:** `src/app/components/TitleBar.tsx`, `src/app/hooks/useTheme.ts`

28×28 ghost button on the right (`pr-[10px]`), `text-text2`, hover `bg-hover`,
radius 6. Sun icon when dark, moon when light — matching the design's toggle
direction (the icon shows the mode you'd switch *to*'s opposite: it renders sun
while `isDark`). Use `SunIcon`/`MoonIcon` from lucide.

Clicking flips between explicit `light` and `dark`; the first click from
`system` resolves to the opposite of the current system mode. Keep the
`mod+shift+l` hotkey wired to the same action. Add `-webkit-app-region: no-drag`
(already covered by the `.title-bar button` rule).

### 1.3 Main layout skeleton

**Files:** `src/app/App.tsx`

Column: title bar → row(sidebar, splitter, main) → nothing else. The main column
becomes: tab bar → toolbar → editor (`flex-1`) → results splitter → results pane
→ status bar. The results pane is a **flex sibling**, not an overlay — this is
the structural change that `ResultSheet` currently blocks.

---

## Phase 2 — Sidebar

### 2.1 Resizable sidebar shell

**Files:** `src/app/components/AppSidebar.tsx`, new
`src/app/components/ResizeHandle.tsx`, new `src/app/hooks/use-persisted-size.ts`

- `bg-panel2`, `border-r border-border`, default width 264px, clamped 200–380.
- Drag handle: 5px wide, `-mx-[2px]`, `cursor-col-resize`, `z-10`.
- Persist the width (`localStorage`, key `ui:sidebarWidth`).
- Keyboard: arrow keys resize by 10px (40px with shift), matching the
  accessibility behaviour `ResultSheet` already has.
- The worksheets block is `max-h-[44%]`; the databases block takes the rest.
- 1px `bg-border` divider with `my-1` between the two blocks.
- **Remove the traces footer** — the Activity button moves to the status bar
  (task 7.4).

Extract the handle and the persisted-size hook so the results splitter (task
6.1) reuses them.

### 2.2 Section headers

**Files:** `WorksheetExplorer.tsx`, `DatabaseExplorer.tsx`

Label: 11px, weight 600, `tracking-[0.08em]`, uppercase, `text-text3`. Add
button: 22×22, radius 5, `text-text2`, hover `bg-hover`, 12px plus icon.
Padding `pt-[14px] pr-3 pb-2 pl-4` for worksheets, `pt-[10px]` for databases.

Rename "Database Explorer" → **"Databases"** to match the design. Update
`src/app/components/DatabaseExplorer.test.tsx:100`.

### 2.3 Filter inputs

**Files:** `src/app/components/SearchInput.tsx`, both explorers

Height 28, `pl-[27px] pr-[10px]`, `border border-border`, radius 6, `bg-panel`,
12px, focus `border-accent` with no ring. Magnifier 12px at `left-[9px]`,
`text-text3`. Margin `mx-3 mb-2`.

Make the placeholder a prop: **"Filter worksheets"** and **"Filter tables"**.
Update `SearchInput.test.tsx` and `DatabaseExplorer.test.tsx`, which both query
by the `Search...` placeholder.

### 2.4 Worksheet rows

**Files:** `WorksheetExplorer.tsx`

- Row height `var(--item-h)`, `px-2`, radius 6, `gap-2`, hover `bg-hover`.
- Active: `bg-[var(--sel)]`, `text-text`, icon `text-accent`. The current
  `shadow-[inset_2px_0_0]` left bar is **not** in the design — remove it.
- Icon 13px; name 12.5px, truncated, `flex-1`.
- **New: database badge.** Right-aligned chip with the worksheet's database
  name — 10px mono, `text-text3`, `bg-bg`, `border border-border2`, radius 4,
  `px-[5px] py-[1.5px]`, `max-w-[76px]` truncated. Resolve the name from
  `useDatabases()` by `worksheet.databaseId`; render nothing when the worksheet
  has no database.
- List container `px-2 pb-2` with `gap-[1px]`.
- Keep double-click rename and drag reorder; size the rename input to fit a
  30px row (`h-[22px]`, 12.5px).

### 2.5 Database tree rows

**Files:** `DatabaseExplorer.tsx`

Three levels, each `rounded-md` with hover `bg-hover`:

| Level    | Height | Padding        | Content                                                        |
| -------- | ------ | -------------- | -------------------------------------------------------------- |
| Database | `var(--item-h)` | `px-[6px]` | 10px chevron (rotate 90 on open, 150ms) · 13px db icon · 12.5px `text-text` name |
| Table    | 26px   | `pl-5 pr-[6px]` | 9px chevron · 12px table icon · 12px mono name                 |
| Column   | 23px   | `pl-[46px] pr-[6px]` | 11.5px mono name · 10.5px mono `text-text3` type pushed right (`ml-auto`) |

Changes from today: the `border-l` guide lines go away in favour of indentation;
the column line splits `name (type)` into a left name and a right-aligned type;
chevrons shrink at each level. Keep the multi-schema suffix badge — it solves a
real collision on multi-schema databases — styled like the worksheet db badge.

Keep the existing context menus (Edit/Delete, Query Table) and restyle them.

---

## Phase 3 — Worksheet tabs (new functionality)

### 3.1 Tab state

**Files:** new `src/app/store/tabs-slice.ts`, `src/app/store/index.ts`,
`src/app/store/editor-slice.ts`, `src/app/worksheet-selection.ts`

State: `{ openWorksheetIds: string[], activeWorksheetId?: string }`. Actions:
`tabOpened`, `tabClosed`, `tabActivated`, `tabsReordered` (optional). Rules
taken from the design's `open`/`closeTab`:

- Selecting a worksheet in the sidebar opens it if it isn't open, then activates
  it.
- Closing the active tab activates the **last** remaining tab.
- Closing the final tab is allowed; the editor area shows the "no worksheet"
  state (see 3.3). The design instead reopens a default worksheet — that only
  makes sense with its hardcoded fixtures.
- Closing a tab must not delete the worksheet.

`state.editor.openWorksheetId` becomes derived from
`state.tabs.activeWorksheetId`; migrate readers in `App.tsx`,
`WorksheetExplorer.tsx`, `DatabaseSelector.tsx`, and `AppShell.tsx`.

Reconcile with `pickWorksheetToOpen`: on boot, restore persisted tabs, drop ids
that no longer exist, and fall back to the current most-recently-opened pick
when nothing survives.

### 3.2 Tab persistence

**Files:** `src/app/store/tabs-slice.ts` or a small subscriber in
`src/app/store/index.ts`

Persist `{ openWorksheetIds, activeWorksheetId }` to `localStorage` under
`ui:tabs:v1` and rehydrate on boot. Guard the parse — a malformed value falls
back to defaults, same pattern as `theme-bootstrap.ts`. Write on change via a
store subscriber rather than inside the reducer, so the reducers stay pure and
unit-testable.

### 3.3 Tab bar component

**Files:** new `src/app/components/WorksheetTabs.tsx`

- Bar: 37px, `bg-panel2`, `border-b border-border`, `items-stretch`.
- Tab: `pl-[14px] pr-[10px]`, 12.5px, `border-r border-border`,
  `max-w-[200px]`, truncated label, `gap-2`.
- Active tab: `bg-panel`, `text-text`, `shadow-[inset_0_2px_0_var(--accent)]`.
  Inactive: transparent, `text-text2`.
- Close button: 16×16, radius 4, `text-text3`, hover `bg-hover` + `text-text`,
  8px × glyph. Must `stopPropagation` so closing doesn't also select.
- Trailing new-tab button: 24×24, `ml-[6px]`, self-centered, `text-text3`,
  hover `bg-hover` + `text-text`.
- Overflow: the design doesn't address more tabs than fit. Use
  `overflow-x-auto` with hidden scrollbar and scroll the active tab into view on
  change.
- Middle-click closes a tab; `mod+w` closes the active one.

### 3.4 No-worksheet state

**Files:** `src/app/App.tsx`

Today `App.tsx:188` early-returns a bare title bar when there's no worksheet.
With tabs, render the full chrome (tab bar with only the "+" button, disabled
toolbar, empty editor slot, idle results pane, status bar) and a centred prompt
in the editor area: **"No worksheet open"** / *"Create a worksheet or pick one
from the sidebar."*

---

## Phase 4 — Toolbar

### 4.1 Toolbar shell

**Files:** new `src/app/components/WorksheetToolbar.tsx` (replaces
`WorksheetHeader.tsx`)

Height 46px, `px-3`, `bg-panel`, `border-b border-border2`, `gap-2`, Run on the
left, connection picker on the right.

### 4.2 Run button

**Files:** `WorksheetToolbar.tsx`, `src/app/components/ui/button.tsx`

Height 29, `px-[11px]`, `bg-[var(--accent-btn)]`, white text, radius 6, 12.5px,
weight 500, `gap-[7px]`, hover `brightness-110`. Contents: 10px play triangle
(or an 11px spinner while running) · **"Run"** · a `⌘↵` badge at 10.5px,
`bg-white/[0.18]`, radius 4, `px-1 py-[1px]`, weight 400.

The label is new — today it's icon-only. Show `Ctrl↵` on non-macOS, as
`WorksheetHeader.tsx:10` already does.

Disabled state (no active statement / no database): 50% opacity, tooltip keeps
today's copy — *"Place your cursor in a statement to run it."*

While a query is running, the button switches to a **Cancel** affordance or the
cancel action moves here from `QueryResultContent`. The design shows only a
spinner, but cancel must stay reachable — put a secondary "Cancel" button next
to Run while `isQueryRunning`.

### 4.3 Searchable connection picker

**Files:** new `src/app/components/ConnectionPicker.tsx` (replaces
`DatabaseSelector.tsx`)

Trigger: height 29, `px-[10px]`, transparent, `border border-border`, radius 6,
12.5px, hover `bg-hover`. Contents: 12px db icon `text-text3` · database name
truncated at `max-w-[170px]` · 9px chevron.

Popover: `top-[34px] right-0`, `min-w-[210px]`, `bg-panel`,
`border border-border`, radius 8, `shadow-[0_8px_24px_rgba(0,0,0,0.14)]`,
`p-1`, `z-50`. First child is an autofocused search input styled like the
sidebar filters but with `bg-panel2` and the placeholder **"Search databases"**.
Options: `px-[10px] py-[7px]`, radius 5, 12.5px, `gap-2`, hover `bg-hover`.

Behaviour to preserve/add: selecting updates `worksheet.databaseId` optimistically
(as `DatabaseSelector.tsx:37` does); closes on outside click and on `Escape`;
arrow keys move the highlight and `Enter` selects. Empty state when the filter
matches nothing: *"No databases match that search."* With zero databases
configured, the trigger reads **"No database"** and opens the add-database form.

`radix-ui/react-select` is no longer the right primitive here. Either hand-roll
with the existing tooltip/popper deps or add `@radix-ui/react-popover` +
`cmdk`; hand-rolling keeps the dependency count down for one dropdown.

### 4.4 Save indicator

The design has no save indicator. `useWorksheetAutosave` still needs to surface
failures — move the state out of the toolbar and into the status bar (task 7.3):
silent while idle/saving, and **"Save failed"** in `text-err` on error.

---

## Phase 5 — Editor

### 5.1 Retheme CodeMirror

**Files:** `src/app/components/codemirror-theme.ts` (rename the exports off
`catppuccin*`)

- Editor background `var(--panel)`, text `var(--text)`.
- Font `var(--mono)`, size `var(--code-size)`, line height `var(--code-lh)`,
  content padding `12px 0`.
- Gutter: no background fill (the design's gutter sits on the editor
  background), width 46px, right-aligned, `pr-4`, 11.5px, `var(--text3)`,
  `user-select: none`, no right border.
- Syntax: keyword `--syn-kw`, string `--syn-str`, number `--syn-num`,
  function `--syn-fn`, operator `--syn-op`, everything else `--text`. Comments
  `--text3` italic; `null`/`bool` follow `--syn-num`.
- Selection `var(--sel)`; active-statement gutter marker
  `color-mix(in oklab, var(--accent) 20%, transparent)`.
- Autocomplete tooltip matches the connection popover: `bg-panel`,
  `border-border`, radius 8, same shadow; selected row `bg-hover`.

### 5.2 Format query button

**Files:** `src/app/components/WorksheetEditor.tsx`, `package.json`

28×28 button pinned `top-[10px] right-[14px]`, `z-20`,
`border border-border`, `bg-panel`, radius 6, `text-text3`, `opacity-75`,
hover full opacity + `bg-hover` + `text-text`, sparkles icon 14px, title
"Format query".

Add `sql-formatter` and map the database type to its dialect (`postgresql`,
`mysql`, `sqlite`). Format the selection if there is one, otherwise the whole
document, and dispatch it as a single undoable transaction so `mod+z` restores
the original. Bind `mod+shift+f`.

Failure path: a malformed statement makes the formatter throw — catch it and
toast **"Could not format this SQL"** with description *"The statement has a
syntax error the formatter could not parse. Fix it and try again."* Never
replace the document with partial output.

### 5.3 Report cursor line/column

**Files:** `WorksheetEditor.tsx`, `src/app/App.tsx`

`onCursorPositionChange` currently emits only a character offset. Add a second
callback (or widen the payload) carrying `{ column, line, offset }` derived from
`state.doc.lineAt(head)`. The status bar consumes it; the existing
`findActiveStatementIndex` path keeps using the offset.

---

## Phase 6 — Results pane

### 6.1 Dock the pane

**Files:** `src/app/components/ResultSheet.tsx` → rename to `ResultsPane.tsx`,
`src/app/App.tsx`

- Stop absolutely positioning it over the editor; it becomes a fixed-height flex
  sibling that shrinks the editor.
- Default height 320 (today 400), clamped 120–620 (today 80 → 80vh).
- Splitter: 7px tall, `-my-[3px]`, `cursor-row-resize`, `z-10`, no visible grip
  handle. Reuse the handle component from task 2.1 and keep the arrow-key
  resizing.
- Persist the height under `ui:resultsHeight`.
- `border-t border-border`, `bg-panel`.
- **Always rendered**, including before the first run — the idle state is part
  of the design. This removes the `isOpen`/`height: 0` collapse.
- `ResultSheet.test.tsx` asserts on the old header; rewrite it for the new
  structure.

### 6.2 Results header

**Files:** `ResultsPane.tsx`

37px, `px-2`, `bg-panel2`, `border-b border-border2`, `gap-[2px]`.

- Left: **Results** / **Messages** tab buttons — height 25, `px-[10px]`,
  radius 5, 12px, weight 500. Active `bg-[var(--sel)]` + `text-text`, inactive
  transparent + `text-text3`, hover `text-text`.
- Right: meta line, 11.5px mono `text-text3`.
  - Success: `100 rows · 2,373 ms · 4 min ago` — locale-formatted count with a
    `+` suffix when `result.truncated`, locale-formatted duration from
    `finishedAt - queriedAt`, and the existing `TimeAgo` component.
  - Error: `failed · 143 ms`.
  - Idle: empty.

The tab selection is per-worksheet state so switching tabs doesn't reset it.

### 6.3 Idle state

**Files:** new `src/app/components/QueryResultEmpty.tsx`

Centred, `gap-[10px]`: a 38px circle with `border-[1.5px] border-border` holding
a 13px play triangle in `text-text3`; **"No results yet"** at 13px weight 500
`text-text2`; hint at 12px `text-text3` — *"Press ⌘↵ or click Run to execute
this worksheet"* (`Ctrl↵` on non-macOS).

### 6.4 Loading state

**Files:** `src/app/components/QueryResultContent.tsx`

Replace the current elapsed-time panel with the design's: centred, `gap-3`, a
20px spinner (`border-2 border-border`, `border-t-accent`) and
**"Running on {database name}…"** at 12.5px `text-text2`.

Keep cancel reachable — it moves to the toolbar (task 4.2). Keep the elapsed
counter, but as a small `text-text3` line under the label rather than the
current stat block; a long-running query with no elapsed feedback is worse than
the design's static text.

### 6.5 Error state

**Files:** `QueryResultContent.tsx`

`p-4`, then a card: `border border-[var(--err-border)]`,
`bg-[var(--err-bg)]`, radius 8, `px-4 py-[13px]`, mono 12px, `leading-[1.6]`.

- Title line: `text-[var(--err)]`, weight 600, `mb-[6px]` — the first line of
  the driver error (e.g. `ERROR 42P01: relation "Employes" does not exist`).
- Detail `<pre>`: `text-text2`, `whitespace-pre-wrap`, the remaining lines
  (Postgres `LINE`/`HINT` context, MySQL/SQLite equivalents).
- Below the card: `Failed after {ms} ms`, 11.5px `text-text3`, `mt-[10px]`.

Adapters return one flat error string today, so add a small splitter: first line
→ title, remainder → detail; when there's only one line, render the card without
the `<pre>`.

Keep the canceled-query branch (`canceledQueryMessage`) as its own quiet state:
a ban icon and **"Query canceled."** in `text-text2`, not the red card.

### 6.6 Results table

**Files:** `src/app/components/QueryResultTable.tsx`, `src/app/components/ui/table.tsx`

- `border-collapse: separate`, `border-spacing: 0`, `min-w-full`.
- Header cells: sticky `top-0 z-[5]`, `bg-panel2`, height 31, `px-[14px]`,
  12px weight 500 `text-text2`, `border-b border-border`, `whitespace-nowrap`,
  left-aligned. The row-number header is a 44px-wide empty cell.
- Body cells: height `var(--row-h)`, `border-b border-border2`, mono 12px,
  `px-[14px]`, `whitespace-nowrap`. Row-number cell: `px-[10px]`, mono 11px,
  `text-text3`, right-aligned, `select-none`.
- Row hover `bg-hover`. Drop the per-cell vertical borders the current table
  draws.
- `null` renders as a dimmed `NULL` in `text-text3` italic (keep
  `formatCellValue`); numeric columns stay right-aligned.
- Remove the pager footer and virtualize the row list with
  `@tanstack/react-virtual` (new dependency), so the full 10,000-row cap
  scrolls in one region. The sticky header stays outside the virtualized body;
  the row-number gutter reads its index from the virtual item, not from
  `map`. Keep the context menu (Copy / Copy Column Name / Copy Row as
  CSV/JSON) — it's not in the design but it's real functionality.
- Column widths need to be stable across the windowed rows, or columns will
  jitter as you scroll. Measure once from the first page of rows and pin them,
  rather than letting the browser auto-size per render.
- Add a typed `QueryResultDto` in place of the `result: any` /
  `field: any` casts at `QueryResultTable.tsx:33,47` while the file is being
  rewritten; the contract type already exists in `src/glue/api/schemas.ts`.

### 6.7 Messages tab (new functionality)

**Files:** new `src/app/components/QueryMessages.tsx`,
new `src/app/hooks/use-worksheet-messages.ts`

`p-3 px-4`, mono 12px, `leading-[1.9]`. Each row: `gap-[14px]`, `HH:mm:ss`
timestamp in `text-text3`, message in `text-text2`.

Derive the log from the worksheet's queries (`useQueriesList()` already has
everything) rather than adding storage:

- On run: the first line of the statement.
- On success: `{n} rows in {ms} ms`.
- On failure: the error's first line.
- On cancel: `Query canceled.`
- Database change: `Connected to {name} ({type})`. The design's
  `read/write` suffix has no backing data — drop it.

Cap the list (say 200 entries, newest last) so a long session can't grow
unbounded, and show **"No messages yet"** in `text-text3` when empty.

---

## Phase 7 — Status bar (new functionality)

### 7.1 Status bar shell

**Files:** new `src/app/components/StatusBar.tsx`, `src/app/App.tsx`

27px, `border-t border-border`, `bg-panel2`, `gap-4`, `px-[14px]`, 11.5px,
`text-text2`. Left group then a spacer then a right group.

### 7.2 Left group

- 7px health dot + connection name. `--ok` when the last query on this
  worksheet succeeded, `--text3` when nothing has run, `--err` when the last run
  failed. The dot is a record of the last run, not a live probe, so the `title`
  says so: *"Last query succeeded"* / *"No queries run yet"* / *"Last query
  failed"*.
- **Server version** in `text-text3` (e.g. `PostgreSQL 16`) — see 7.5.
- Run summary in `text-text3`: `100 rows in 2.37 s`, or `Query failed`, or
  empty.

### 7.3 Right group

- `Ln {line}, Col {column}` in `text-text3`, fed by task 5.3.
- `UTF-8` in `text-text3` — static.
- Autosave failures from task 4.4, in `text-err`.

### 7.4 Traces entry point

**Files:** `StatusBar.tsx`, `AppSidebar.tsx`

Move the Activity button out of the sidebar footer into the right group: an
icon-only 11px button, `text-text3`, hover `text-text`, tooltip "Traces ⌘⇧T".
The `mod+shift+t` hotkey is unchanged.

### 7.5 Server version probe (backend)

**Files:** `src/databases/adapter.ts`, `postgres-adapter.ts`, `mysql-adapter.ts`,
`sqlite-adapter.ts`, `src/glue/api/schemas.ts`, `src/glue/api/groups/databases.ts`,
`src/server/http/server.ts`, `src/app/hooks/queries.ts`

Add an optional `getServerVersion(): Promise<string>` to `DatabaseAdapter`:

- Postgres — `SHOW server_version` → `PostgreSQL 16.2` → display `PostgreSQL 16`.
- MySQL — `SELECT VERSION()` → `MySQL 8.4` (MariaDB reports itself in the same
  string; pass it through).
- SQLite — `select sqlite_version()` → `SQLite 3.45`.

Expose it on the existing schema response (`SchemaInfo` already round-trips per
database and is cached in the renderer) rather than adding a route — one fewer
endpoint, and the explorer already fetches it. Give the query a timeout per the
memory rules in `CLAUDE.md`, and render nothing in the status bar when the probe
fails; a missing version must never surface an error to the user.

---

## Phase 8 — Surfaces the design doesn't cover

The design shows only the main editor window. These still need the new tokens or
they'll look broken next to it.

### 8.1 Getting-started screen

**Files:** `src/app/components/GettingStartedScreen.tsx`

Retoken: `bg-panel2` backdrop, `text-text`/`text-text2` copy, accent wordmark
(the `font-display` class goes away with Bricolage). Keep the copy.

### 8.2 Database form and modal

**Files:** `src/app/components/EditorScreen.tsx`, `DatabaseForm.tsx`,
`src/app/components/ui/{input,label,form,select,button}.tsx`

Backdrop `bg-bg/70`; card `bg-panel`, `border border-border`, radius 8,
`shadow-[0_8px_24px_rgba(0,0,0,0.14)]`. Inputs adopt the design's field style:
height 28–32, `border border-border`, radius 6, `bg-panel2`, focus
`border-accent` with no ring. Errors in `text-[var(--err)]`.

### 8.3 Trace dashboard

**Files:** `src/app/components/traces/*.tsx`

Retoken the trace list, waterfall, and span detail panel. The waterfall bars
currently use Catppuccin accents — map them onto `--accent`,
`--accent-soft`, `--ok`, and `--err`.

### 8.4 Toasts

**Files:** `src/renderer.tsx`

Pass `toastOptions` to `<Toaster />` so sonner picks up `--panel`, `--border`,
`--text`, radius 8, and the design's shadow. Error toasts use `--err`.

### 8.5 Shared primitives

**Files:** `src/app/components/ui/*.tsx`

`button.tsx` needs the design's sizes (29px default, 28px and 22px icon
variants) and a `primary` variant using `--accent-btn`. `tooltip.tsx`,
`context-menu.tsx`, and `select.tsx` all need the popover treatment from task
4.3 so every floating surface matches.

---

## Phase 9 — Verification

### 9.1 Update affected tests

Known breaks: `SearchInput.test.tsx` (placeholder), `DatabaseExplorer.test.tsx`
(placeholder + "Database Explorer" heading), `ResultSheet.test.tsx` (header
structure), `WorksheetExplorer.test.tsx` (row markup). Add coverage for the new
logic: tabs slice reducers, the message-log builder, the error title/detail
split, and cursor line/column reporting — all small side-effect-free modules,
which is where unit tests earn their keep.

### 9.2 Both themes

Drive the running app and screenshot each state against the design: idle,
loading, error, results, messages — in light and dark.

```bash
yarn start
agent-browser --cdp 9222 screenshot
```

### 9.3 Checks

`yarn lint`, `yarn typecheck`, `yarn test` all clean. Confirm the OKLCH relative
color syntax (`oklch(from var(--accent) …)`) renders in the packaged build's
Chromium, not just in dev.

---

## Suggested order

Phase 0 → 1 unblocks everything visually. Phases 2, 4, 5 are independent and can
land in any order. Phase 3 (tabs) and Phase 6 (docked results) are the two
structural changes and should each land as their own commit. Phase 7 depends on
5.3 and 7.5. Phase 8 can trail behind, but shouldn't ship later than the release
that changes the tokens.
