---
name: dashboard-ui
description: "Build admin and analytics dashboards: sidebar/topbar layout, KPI tiles, data tables with sort, filter and pagination, Chart.js charts and choosing the right chart, loading/empty/error states, responsive behavior and dark theme. Use when the user asks for a dashboard, admin panel, analytics page, back office or reporting UI."
---

# Dashboard UI

A dashboard answers a few recurring questions at a glance, then lets the user drill into detail.
Start by listing those questions; every tile, chart and table must answer one.

## 1. Layout
- Desktop: fixed left sidebar 240px (collapsible to 64px icons), topbar 56–64px (page title, search,
  date range, user menu), main content with 24px padding, max width ~1440px.
- Mobile (<768px): sidebar becomes an off-canvas drawer opened by a menu button; KPI tiles 2 per row;
  tables scroll horizontally inside their card, or turn into stacked cards.
```css
.app{display:grid;grid-template-columns:240px 1fr;min-height:100vh}
.main{display:grid;gap:24px;padding:24px;align-content:start}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}
.charts{display:grid;grid-template-columns:2fr 1fr;gap:16px}
@media (max-width:1024px){.charts{grid-template-columns:1fr}}
@media (max-width:768px){.app{grid-template-columns:1fr}.sidebar{display:none}}
```
- Order top to bottom: KPIs, main trend chart, supporting charts, detailed table.

## 2. KPI tiles
Each tile: label (13px muted), value (28–32px, `font-variant-numeric: tabular-nums`), delta vs previous
period with arrow and color (green up / red down, but invert for metrics where down is good, like
churn), and optionally a sparkline. Format numbers: `Intl.NumberFormat` with compact notation
(`12.4K`), currency and percent with fixed decimals. 4–6 tiles max.

## 3. Tables
- Columns: text left-aligned, numbers right-aligned with tabular numerals, dates in one format.
- Sticky header, row height 44–52px, zebra or hover highlight (not both), row actions at the end.
- Sorting: click header toggles asc/desc, show the arrow, `aria-sort` on the `th`.
- Filtering: a search box (debounced 250ms) plus 1–3 select filters; show active filters as removable chips.
- Pagination: 25 rows default, "1–25 of 340", prev/next; keep sort/filter state in the URL query string.
- Large data or a real backend: do sort/filter/paginate on the server.
- React: TanStack Table (`npm i @tanstack/react-table`) for headless sorting/filtering/pagination.

## 4. Charts with Chart.js
`<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>` or `npm i chart.js`.
Choose by question:
- Trend over time: line (area if one series). Comparing categories: horizontal bar, sorted.
- Part of whole: stacked bar or a single 100% bar; donut only with 2–5 slices.
- Distribution: histogram (bar with bins). Relationship: scatter. Never 3D, never pie with 8 slices.
```js
new Chart(document.getElementById('rev'), {
  type: 'line',
  data: { labels, datasets: [{ label: 'Revenue', data, borderColor: '#4f46e5',
    backgroundColor: 'rgba(79,70,229,.12)', fill: true, tension: .3, pointRadius: 0 }] },
  options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: v => '$' + v / 1000 + 'k' } } } }
});
```
Put the canvas in a wrapper with a fixed height (`.chart{position:relative;height:300px}`), or
`maintainAspectRatio:false` makes it grow forever. Destroy the chart (`chart.destroy()`) before
re-creating it (React effects, filter changes). Every chart card has a title that states the question.

## 5. States
- Loading: skeleton tiles and a skeleton table (gray bars at the real sizes), no layout shift when data arrives.
- Empty: "No orders in this period" + action (change date range / create first item).
- Error: inline in the card that failed, with Retry; other cards keep working.
- Show "Updated 2 min ago" and the active date range clearly.

## 6. Dark theme
Background `#0b0f17`, cards `#131a26`, borders `#243044`, text `#e2e8f0`, muted `#94a3b8`.
For Chart.js set `Chart.defaults.color = '#94a3b8'` and `Chart.defaults.borderColor = '#243044'`
before creating charts. Use the same series colors in both themes, slightly lighter in dark.

## 7. Data
Without a backend, generate realistic deterministic sample data (seeded, plausible ranges, weekly
seasonality), not `Math.random()` noise, and say it is sample data. With a backend, one endpoint per
card or one summary endpoint; fetch in parallel.

## Check before you finish
1. run_app the project (or open the HTML) and inspect_preview at 1280px and 375px.
2. No console errors; charts render with correct sizes; no chart grows on resize.
3. Sort, filter and paginate the table; check the counts are right.
4. Force the empty and error states once.
5. Numbers formatted consistently; delta colors correct.

## Common mistakes
- Too many charts with no question behind them; rainbow color series.
- Canvas without a sized wrapper; charts created twice on re-render.
- Left-aligned numbers, inconsistent decimals.
- Spinner covering the whole page instead of per-card skeletons.
