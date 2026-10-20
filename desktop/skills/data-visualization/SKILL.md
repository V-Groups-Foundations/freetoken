---
name: data-visualization
description: "Make charts that communicate: choose the chart from the question (comparison, trend, distribution, part-to-whole, relationship), build it with Chart.js or D3 from a CDN, label it directly, use color sparingly and accessibly, make it responsive and remove chart junk. Use when the user asks for a chart, graph, plot, visualization, infographic or to visualize data."
---

# Data visualization

Start from the question the chart answers. Write it as the chart title: "Revenue doubled after the
March launch", not "Revenue by month".

## 1. Choose the chart from the question
| Question | Chart |
|---|---|
| How do categories compare? | Bar (horizontal if labels are long), sorted by value |
| How does it change over time? | Line (area for one cumulative series); bars for few discrete periods |
| How is it distributed? | Histogram, box plot; dot/strip plot for small data |
| What share of the whole? | Single stacked/100% bar; donut only for 2–5 parts |
| How do two variables relate? | Scatter (bubble for a third variable) |
| Where? | Choropleth map (D3 + TopoJSON) |
| One number | Big number with comparison ("+12% vs last month"), no chart |
Avoid: pie with 6+ slices, 3D anything, dual y-axes (use two charts), radar charts for non-experts.

## 2. Tools
- Chart.js for standard charts fast: `<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>`
  (npm: `chart.js`; React: `react-chartjs-2`).
- D3 for custom or unusual charts, maps, full control:
  `<script type="module">import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";</script>` (npm: `d3`).
- Python notebooks/scripts: matplotlib or Plotly.

## 3. Chart.js example (sorted horizontal bar, direct labels)
```html
<div style="position:relative;height:320px"><canvas id="c" aria-label="Signups by channel" role="img"></canvas></div>
<script>
const rows = [['Organic search',4120],['Referral',2380],['Paid social',1510],['Email',960],['Other',310]];
new Chart(document.getElementById('c'), {
  type: 'bar',
  data: { labels: rows.map(r => r[0]), datasets: [{ data: rows.map(r => r[1]),
    backgroundColor: rows.map((r, i) => i === 0 ? '#2563eb' : '#cbd5e1'), borderRadius: 4 }] },
  options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, title: { display: true, text: 'Organic search drives 45% of signups' } },
    scales: { x: { grid: { color: '#eef2f7' }, ticks: { callback: v => v.toLocaleString() } }, y: { grid: { display: false } } } }
});
</script>
```

## 4. D3 essentials
Margin convention, scales, axes, data join:
```js
const m = { top: 20, right: 20, bottom: 30, left: 40 }, w = 640 - m.left - m.right, h = 320 - m.top - m.bottom;
const svg = d3.select('#chart').append('svg').attr('viewBox', `0 0 ${w + m.left + m.right} ${h + m.top + m.bottom}`)
  .append('g').attr('transform', `translate(${m.left},${m.top})`);
const x = d3.scaleUtc().domain(d3.extent(data, d => d.date)).range([0, w]);
const y = d3.scaleLinear().domain([0, d3.max(data, d => d.value)]).nice().range([h, 0]);
svg.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(6));
svg.append('g').call(d3.axisLeft(y).ticks(5));
svg.append('path').datum(data).attr('fill', 'none').attr('stroke', '#2563eb').attr('stroke-width', 2)
  .attr('d', d3.line().x(d => x(d.date)).y(d => y(d.value)));
```
`viewBox` without fixed width/height makes it scale with its container.

## 5. Labeling
- Title states the takeaway; subtitle gives units, period and source.
- Label lines directly at their end instead of a legend when there are 2–4 series.
- Axis labels with units ("Revenue (USD, thousands)"); format numbers (`12.4K`, `$1.2M`, `34%`).
- Bar charts start at zero. Line charts may zoom the y-axis but say so if it exaggerates.
- 4–6 axis ticks; light or no gridlines; no borders around the plot.

## 6. Color
- Default to one neutral (gray) plus **one accent** for the data that matters.
- Categorical: at most 6–8 colors from a tested palette (e.g. Okabe-Ito: `#E69F00 #56B4E9 #009E73
  #F0E442 #0072B2 #D55E00 #CC79A7`, colorblind-safe). Sequential: one hue light-to-dark (`d3.interpolateBlues`).
  Diverging (above/below a midpoint): two hues with a neutral middle (`d3.interpolateRdBu`).
- Same series = same color across all charts on the page. Contrast of marks against background ≥ 3:1.
- Never encode meaning by red/green alone; add labels or shapes.

## 7. Responsive and accessible
- Wrap canvases in a sized container (Chart.js `maintainAspectRatio:false` + fixed-height parent).
- On narrow screens: fewer ticks, horizontal bars, shorter labels, legend below.
- Provide `role="img"` + `aria-label` with the takeaway, and a data table or summary for screen readers
  (a `<details>` "Show data" is a good pattern). Tooltips are extra, never the only way to read values.

## Check before you finish
1. Open it (run_app / open_preview) and inspect_preview at 1280px and 375px: chart visible, labels not
   overlapping or cut off, no console errors.
2. Read the chart cold: is the title's claim obvious within 5 seconds?
3. Verify a few plotted values against the source data.
4. Check the colors in grayscale (meaning survives?).

## Common mistakes
- Picking the chart type before knowing the question; rainbow palettes.
- Truncated bar axes; unsorted categorical bars; legend far from data.
- Too much ink: 3D, shadows, heavy gridlines, gradient fills on bars.
- Charts that only render at one size.
