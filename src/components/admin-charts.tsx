'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

export type ChartSeries = { key: string; label: string; color: string };
export type ChartRow = { label: string; detail?: string; values: Record<string, number> };
export type ChartDatum = { label: string; value: number; color?: string };
type Format = 'count' | 'currency';
type SeriesProps = { title: string; data: ChartRow[]; series: ChartSeries[]; format?: Format; compact?: boolean };
const palette = ['#2457eb', '#829cf2', '#183466', '#39a7b4', '#8b6ec8', '#c2cdeb'];
const countFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const moneyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const valid = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, value)) : 0;
const display = (value: number, format: Format = 'count') => format === 'currency' ? moneyFormatter.format(value / 100) : countFormatter.format(value);
const percent = (value: number, total: number) => total ? `${Math.round(value / total * 1000) / 10}%` : '0%';

function useChartWidth(compact: boolean): [RefObject<HTMLDivElement | null>, number] {
 const ref = useRef<HTMLDivElement>(null);
 const [width, setWidth] = useState(compact ? 340 : 540);
 useEffect(() => {
  const element = ref.current;
  if (!element) return;
  const resize = () => { const next = Math.max(260, Math.floor(element.getBoundingClientRect().width)); setWidth(previous => previous === next ? previous : next); };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  return () => observer.disconnect();
 }, []);
 return [ref, width];
}
function usePoints(length: number) {
 const [active, setActive] = useState<number | null>(null);
 const [focusIndex, setFocusIndex] = useState(0);
 const refs = useRef<Array<SVGElement | null>>([]);
 function keydown(event: KeyboardEvent<SVGElement>, index: number) {
  let next = index;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + length) % length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = length - 1;
  else if (event.key === 'Escape') { setActive(null); return; }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(index); return; }
  else return;
  event.preventDefault(); setFocusIndex(next); setActive(next); refs.current[next]?.focus();
 }
 function point(index: number, label: string) {
  return {
   ref: (element: SVGElement | null) => { refs.current[index] = element; },
   tabIndex: index === Math.min(focusIndex, length - 1) ? 0 : -1,
   role: 'button' as const,
   'aria-label': label,
   onFocus: () => { setFocusIndex(index); setActive(index); },
   onBlur: () => setActive(null),
   onPointerEnter: () => setActive(index),
   onPointerLeave: () => { if (document.activeElement !== refs.current[index]) setActive(null); },
   onClick: () => { setFocusIndex(index); setActive(index); },
   onKeyDown: (event: KeyboardEvent<SVGElement>) => keydown(event, index),
  };
 }
 return { active, point };
}
function countScale(maximum: number) {
 const raw = Math.max(1, maximum / 4);
 const power = 10 ** Math.floor(Math.log10(raw));
 const step = Math.max(1, Math.ceil(raw / power) * power);
 const ceiling = Math.max(step, Math.ceil(maximum / step) * step);
 return { ceiling, ticks: Array.from({ length: Math.round(ceiling / step) + 1 }, (_, i) => i * step) };
}
function tickLabel(value: number, format: Format) {
 if (format === 'currency') {
  const rupees = value / 100;
  return rupees >= 100000 ? `₹${+(rupees / 100000).toFixed(1)}L` : rupees >= 1000 ? `₹${+(rupees / 1000).toFixed(1)}k` : `₹${+rupees.toFixed(2)}`;
 }
 return countFormatter.format(value);
}
function Legend({ series }: { series: ChartSeries[] }) {
 return <ul className="admin-chart-legend">{series.map((item, index) => <li key={item.key}><span className={`admin-chart-swatch admin-chart-swatch-${index % 3}`} style={{ background: item.color }} aria-hidden="true" />{item.label}</li>)}</ul>;
}
function DataTable({ title, data, series, format }: { title: string; data: ChartRow[]; series: ChartSeries[]; format: Format }) {
 return <details className="admin-chart-data"><summary>View data for {title}</summary><div className="admin-chart-table-scroll" tabIndex={0} role="region" aria-label={`${title} data table`}><table><caption>{title}{format === 'currency' ? ' — amounts in Indian rupees' : ''}</caption><thead><tr><th scope="col">Period or category</th>{series.map(item => <th scope="col" key={item.key}>{item.label}</th>)}</tr></thead><tbody>{data.length ? data.map((row, i) => <tr key={i}><th scope="row">{row.detail || row.label}</th>{series.map(item => <td key={item.key}>{display(valid(row.values[item.key]), format)}</td>)}</tr>) : <tr><td colSpan={series.length + 1}>No data available.</td></tr>}</tbody></table></div></details>;
}
function Empty({ title }: { title: string }) {
 return <div className="admin-chart-empty" role="status"><span aria-hidden="true">—</span><strong>No activity to show yet</strong><p>{title} will appear here when there is data in this view.</p></div>;
}
function RowTooltip({ active, data, series, format }: { active: number | null; data: ChartRow[]; series: ChartSeries[]; format: Format }) {
 const row = active === null ? undefined : data[active];
 return <div className={`admin-chart-tooltip ${row ? 'is-active' : ''}`} aria-live="polite" aria-atomic="true">{row ? <><strong>{row.detail || row.label}</strong><span>{series.map(item => `${item.label}: ${display(valid(row.values[item.key]), format)}`).join(' · ')}</span></> : <span className="admin-chart-hint">Hover or focus the chart. Use arrow keys to explore.</span>}</div>;
}

export function TrendChart({ title, data, series, format = 'count', compact = false }: SeriesProps) {
 const id = useId();
 const [container, width] = useChartWidth(compact);
 const { active, point } = usePoints(data.length);
 const maximum = data.reduce((max, row) => Math.max(max, ...series.map(item => valid(row.values[item.key]))), 0);
 const { ceiling, ticks } = countScale(maximum);
 const height = compact ? 204 : 246;
 const left = Math.max(format === 'currency' ? 65 : 46, ...ticks.map(tick => tickLabel(tick, format).length * 6.5 + 14)), right = 20, top = 16, bottom = 35;
 const chartWidth = width - left - right, chartHeight = height - top - bottom;
 const x = (index: number) => left + (data.length === 1 ? chartWidth / 2 : index / (data.length - 1) * chartWidth);
 const y = (value: number) => top + chartHeight - valid(value) / ceiling * chartHeight;
 const widestLabel = Math.max(1, ...data.map(row => Array.from(row.label).length * 6.5));
 // Endpoints are start/end anchored, so reserve extra room around their full labels.
 const labelSpacing = Math.max(48, widestLabel * 1.6);
 const labelCount = Math.min(data.length, Math.max(2, Math.min(compact ? 4 : 6, Math.floor(chartWidth / labelSpacing) + 1)));
 const labelIndices = new Set([0, data.length - 1]);
 let previousLabel = 0;
 for (let slot = 1; slot < labelCount - 1; slot++) {
  const index = Math.round(slot * (data.length - 1) / (labelCount - 1));
  if (x(index) - x(previousLabel) >= labelSpacing && x(data.length - 1) - x(index) >= labelSpacing) {
   labelIndices.add(index); previousLabel = index;
  }
 }
 return <figure className={`admin-chart ${compact ? 'admin-chart-compact' : ''}`} aria-label={title}><div ref={container} className="admin-chart-canvas">{maximum <= 0 || !series.length ? <Empty title={title} /> : <svg className="admin-chart-svg" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={`${id}-title ${id}-desc`}><title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>Line chart showing {series.map(item => item.label).join(', ')} across {data.length} periods. Values are {format === 'currency' ? 'Indian rupees' : 'counts'}. Focus a period and use arrow keys for its values, or expand the data table.</desc><defs>{series.map((item, index) => <linearGradient key={item.key} id={`${id}-${index}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={item.color} stopOpacity=".14" /><stop offset="100%" stopColor={item.color} stopOpacity="0" /></linearGradient>)}</defs>{ticks.map(tick => <g key={tick} aria-hidden="true"><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="admin-chart-gridline" /><text x={left - 9} y={y(tick) + 4} textAnchor="end" className="admin-chart-axis">{tickLabel(tick, format)}</text></g>)}{data.map((row, index) => labelIndices.has(index) ? <text key={index} x={x(index)} y={height - 10} textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'} className="admin-chart-axis" aria-hidden="true">{row.label}</text> : null)}{series.map((item, seriesIndex) => {
 const coordinates = data.map((row, index) => `${x(index)},${y(valid(row.values[item.key]))}`).join(' ');
 return <g key={item.key} aria-hidden="true">{seriesIndex === 0 && data.length > 1 ? <polygon points={`${x(0)},${y(0)} ${coordinates} ${x(data.length - 1)},${y(0)}`} fill={`url(#${id}-${seriesIndex}-fill)`} /> : null}<polyline points={coordinates} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={seriesIndex % 3 === 1 ? '6 4' : seriesIndex % 3 === 2 ? '2 4' : undefined} />{data.map((row, index) => <circle key={index} cx={x(index)} cy={y(valid(row.values[item.key]))} r={active === index ? 4.5 : data.length === 1 ? 4 : 2.5} fill={item.color} stroke="#fff" strokeWidth="1.5" />)}</g>;
 })}{data.map((row, index) => <g key={index} {...point(index, `${row.detail || row.label}. ${series.map(item => `${item.label}: ${display(valid(row.values[item.key]), format)}`).join('. ')}`)} className="admin-chart-target"><rect x={Math.max(left - 6, x(index) - Math.max(8, chartWidth / Math.max(1, data.length - 1) / 2))} y={top - 4} width={Math.max(16, chartWidth / Math.max(1, data.length - 1))} height={chartHeight + 8} fill="transparent" /><line x1={x(index)} x2={x(index)} y1={top} y2={top + chartHeight} stroke="#899dc6" strokeDasharray="3 4" opacity={active === index ? .65 : 0} /></g>)}</svg>}</div>{maximum > 0 ? <RowTooltip active={active} data={data} series={series} format={format} /> : null}<Legend series={series} /><DataTable title={title} data={data} series={series} format={format} /></figure>;
}

export function BarChart({ title, data, series, format = 'count', compact = false }: SeriesProps) {
 const id = useId();
 const [container, width] = useChartWidth(compact);
 const { active, point } = usePoints(data.length);
 const maximum = data.reduce((max, row) => Math.max(max, ...series.map(item => valid(row.values[item.key]))), 0);
 const { ceiling, ticks } = countScale(maximum);
 const groupHeight = 29 + series.length * (compact ? 15 : 18), height = Math.max(120, data.length * groupHeight + 32);
 const left = 4, right = Math.max(format === 'currency' ? 64 : 46, ...ticks.map(tick => tickLabel(tick, format).length * 6.5 + 14)), chartWidth = Math.max(60, width - left - right);
 return <figure className={`admin-chart ${compact ? 'admin-chart-compact' : ''}`} aria-label={title}><div ref={container} className="admin-chart-canvas">{maximum <= 0 || !series.length ? <Empty title={title} /> : <svg className="admin-chart-svg" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={`${id}-title ${id}-desc`}><title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>Grouped horizontal bars. {series.map(item => item.label).join(', ')} for each category. Focus a group and use arrow keys to explore exact values.</desc>{ticks.map(tick => <g key={tick} aria-hidden="true"><line x1={left + tick / ceiling * chartWidth} x2={left + tick / ceiling * chartWidth} y1={14} y2={height - 24} className="admin-chart-gridline" /><text x={left + tick / ceiling * chartWidth} y={height - 6} textAnchor={tick === 0 ? 'start' : 'middle'} className="admin-chart-axis">{tickLabel(tick, format)}</text></g>)}{data.map((row, index) => {
 const base = index * groupHeight;
 const maxLabel = Math.floor((width - 14) / 6.3);
 const label = row.label.length > maxLabel ? `${row.label.slice(0, maxLabel - 1)}…` : row.label;
 return <g key={index} {...point(index, `${row.detail || row.label}. ${series.map(item => `${item.label}: ${display(valid(row.values[item.key]), format)}`).join('. ')}`)} className="admin-chart-target"><rect x={0} y={base} width={width} height={groupHeight - 3} rx="6" fill={active === index ? '#f2f5fe' : 'transparent'} /><text x={left} y={base + 14} className="admin-chart-category" aria-hidden="true">{label}</text>{series.map((item, seriesIndex) => {
 const value = valid(row.values[item.key]), barWidth = value / ceiling * chartWidth, barY = base + 23 + seriesIndex * (compact ? 15 : 18);
 return <g key={item.key} aria-hidden="true"><rect x={left} y={barY} width={barWidth} height={compact ? 9 : 11} rx="3" fill={item.color} /><text x={Math.min(width - 4, left + barWidth + 7)} y={barY + (compact ? 8 : 10)} className="admin-chart-bar-value">{tickLabel(value, format)}</text></g>;
 })}</g>;
 })}</svg>}</div>{maximum > 0 ? <RowTooltip active={active} data={data} series={series} format={format} /> : null}<Legend series={series} /><DataTable title={title} data={data} series={series} format={format} /></figure>;
}

function ringArc(start: number, share: number): string {
 const position = (fraction: number) => { const angle = fraction / 100 * Math.PI * 2 - Math.PI / 2; return [110 + 77 * Math.cos(angle), 110 + 77 * Math.sin(angle)]; };
 const [x1, y1] = position(start);
 if (share >= 100) {
  const [xm, ym] = position(start + 50);
  return `M ${x1} ${y1} A 77 77 0 1 1 ${xm} ${ym} A 77 77 0 1 1 ${x1} ${y1}`;
 }
 const [x2, y2] = position(start + share);
 return `M ${x1} ${y1} A 77 77 0 ${share > 50 ? 1 : 0} 1 ${x2} ${y2}`;
}

export function DonutChart({ title, data, centerLabel = 'Total', compact = false }: { title: string; data: ChartDatum[]; centerLabel?: string; compact?: boolean }) {
 const id = useId();
 const segments = data.map((item, index) => ({ item, index })).filter(({ item }) => valid(item.value) > 0);
 const { active, point } = usePoints(segments.length);
 const total = data.reduce((sum, item) => sum + valid(item.value), 0);
 const activeSegment = active === null ? undefined : segments[active];
 const activeDatum = activeSegment?.item;
 let offset = 0;
 return <figure className={`admin-chart admin-chart-donut ${compact ? 'admin-chart-compact' : ''}`} aria-label={title}>{total <= 0 ? <Empty title={title} /> : <div className="admin-chart-donut-layout"><svg className="admin-chart-ring" viewBox="0 0 220 220" width="220" height="220" role="group" aria-labelledby={`${id}-title ${id}-desc`}><title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>Donut chart with a total of {display(total)}. Each segment represents a category. Focus a segment and use arrow keys to explore it. The legend and data table include all values, including zero counts.</desc><circle cx="110" cy="110" r="77" fill="none" stroke="#edf1f8" strokeWidth="25" aria-hidden="true" />{segments.map(({ item, index }, segmentIndex) => {
 const share = valid(item.value) / total * 100, start = offset;
 offset += share;
 return <path key={index} {...point(segmentIndex, `${item.label}: ${display(valid(item.value))}, ${percent(valid(item.value), total)}`)} className="admin-chart-segment" d={ringArc(start, share)} fill="none" stroke={item.color || palette[index % palette.length]} strokeWidth={active === segmentIndex ? 31 : 25} opacity={active === null || active === segmentIndex ? 1 : .6} style={{ pointerEvents: 'stroke' }} />;
 })}<text x="110" y="109" textAnchor="middle" className="admin-chart-total" style={display(total).length > 9 ? { fontSize: 19 } : undefined} aria-hidden="true">{display(total)}</text><text x="110" y="132" textAnchor="middle" className="admin-chart-center-label" aria-hidden="true">{centerLabel.length > 22 ? `${centerLabel.slice(0, 21)}…` : centerLabel}</text></svg><ul className="admin-chart-donut-legend">{data.map((item, index) => <li key={index} className={activeSegment?.index === index ? 'is-active' : ''}><span className="admin-chart-swatch" style={{ background: item.color || palette[index % palette.length] }} aria-hidden="true" /><span>{item.label}</span><strong>{display(valid(item.value))}<small>{percent(valid(item.value), total)}</small></strong></li>)}</ul></div>}{total > 0 ? <div className={`admin-chart-tooltip ${activeDatum ? 'is-active' : ''}`} aria-live="polite" aria-atomic="true">{activeDatum ? <><strong>{activeDatum.label}</strong><span>{display(valid(activeDatum.value))} · {percent(valid(activeDatum.value), total)} of total</span></> : <span className="admin-chart-hint">Hover or focus a segment. Use arrow keys to explore.</span>}</div> : <ul className="admin-chart-donut-legend">{data.map((item, index) => <li key={index}><span className="admin-chart-swatch" style={{ background: item.color || palette[index % palette.length] }} aria-hidden="true" /><span>{item.label}</span><strong>0<small>0%</small></strong></li>)}</ul>}<details className="admin-chart-data"><summary>View data for {title}</summary><div className="admin-chart-table-scroll" tabIndex={0} role="region" aria-label={`${title} data table`}><table><caption>{title}</caption><thead><tr><th scope="col">Category</th><th scope="col">Count</th><th scope="col">Share</th></tr></thead><tbody>{data.length ? data.map((item, index) => <tr key={index}><th scope="row">{item.label}</th><td>{display(valid(item.value))}</td><td>{percent(valid(item.value), total)}</td></tr>) : <tr><td colSpan={3}>No data available.</td></tr>}</tbody></table></div></details></figure>;
}
