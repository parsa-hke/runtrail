import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { DiffReport, MetricRow } from '../api/types'
import { fmtDuration, fmtNum, relTime } from '../lib/format'
import { Empty, Panel, StatusBadge } from '../components/atoms'
import { LineChart, PALETTE, type Series } from '../components/charts'

export default function DiffPage({ ids }: { ids: string[] }) {
  const [onlyDiff, setOnlyDiff] = useState(false)

  const { data: report, isLoading, error } = useQuery({
    queryKey: ['diff', ids],
    queryFn: () => api.diff(ids),
    enabled: ids.length >= 2,
  })

  const metricQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['metrics', id],
      queryFn: () => api.getMetrics(id),
    })),
  })

  if (ids.length < 2) return <Empty title="Pick at least two runs" hint="Use the run list checkboxes." />
  if (isLoading) return <Empty title="Loading diff…" />
  if (error || !report) return <Empty title="Error" hint={String(error || 'no data')} />

  const runs = report.runs

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto', padding: 16, gap: 16 }}>
      {/* Run pills + controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {runs.map((r, i) => (
          <div
            key={r.id}
            style={{
              padding: 10,
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--surface)',
              minWidth: 220,
              fontFamily: 'var(--mono)',
              fontSize: 11,
            }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: PALETTE[i % PALETTE.length], fontWeight: 700 }}>{String.fromCharCode(65 + i)}</span>
              <StatusBadge status={r.status} />
              <span style={{ color: 'var(--accent)' }}>{r.id}</span>
            </div>
            <div style={{ color: 'var(--fg-2)', marginTop: 4 }}>{r.name}</div>
            <div style={{ color: 'var(--fg-3)', marginTop: 2 }}>
              {fmtDuration(r.duration_s)} · {relTime(r.started_at)}
            </div>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
            only diff
          </label>
        </div>
      </div>

      {/* Insight (2-run only) */}
      {runs.length === 2 && report.insight && report.insight.delta_metric && (
        <InsightPanel report={report} runs={runs} />
      )}

      {/* HParams diff */}
      <Panel title="Hyperparameters">
        <HParamsTable report={report} onlyDiff={onlyDiff} />
      </Panel>

      {/* Final metrics */}
      <Panel title="Final metrics">
        <FinalTable report={report} />
      </Panel>

      {/* Metric overlays */}
      <Panel title="Metric overlay">
        <MetricOverlay runs={runs} metricQueries={metricQueries.map((q) => q.data ?? [])} />
      </Panel>

      {/* Env / hardware */}
      {(Object.keys(report.env?.changed ?? {}).length > 0 || !onlyDiff) && (
        <Panel title="Environment & hardware">
          <EnvHwTable report={report} onlyDiff={onlyDiff} />
        </Panel>
      )}

      {/* Data */}
      {(!report.data?.same || !report.data?.same_hash) && (
        <Panel title="Dataset">
          <DataTable report={report} />
        </Panel>
      )}
    </div>
  )
}

// ── Insight ──────────────────────────────────────────────────────────────────

function InsightPanel({ report, runs }: { report: DiffReport; runs: DiffReport['runs'] }) {
  const ins = report.insight
  if (!ins) return null

  const winnerColor =
    ins.winner === 'A' ? PALETTE[0] :
    ins.winner === 'B' ? PALETTE[1] :
    'var(--fg-2)'

  const winnerLabel =
    ins.winner === 'A' ? `[A] ${runs[0]?.id}` :
    ins.winner === 'B' ? `[B] ${runs[1]?.id}` :
    '(tie)'

  const sign = ins.delta_value >= 0 ? '+' : ''
  const confPct = Math.round((ins.confidence ?? 0) * 100)

  return (
    <div
      style={{
        padding: 14,
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: 'var(--surface)',
        fontFamily: 'var(--mono)',
        fontSize: 11,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-2)' }}>Insight</span>
        {ins.confidence > 0 && (
          <span style={{ color: 'var(--fg-3)', fontSize: 10 }}>
            {confPct}% confidence · heuristic — verify by isolating one change at a time
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {ins.winner && (
          <div>
            <div style={{ color: 'var(--fg-3)', marginBottom: 2 }}>winner</div>
            <div style={{ color: winnerColor, fontWeight: 700 }}>{winnerLabel}</div>
          </div>
        )}
        {ins.delta_metric && (
          <div>
            <div style={{ color: 'var(--fg-3)', marginBottom: 2 }}>{ins.delta_metric}</div>
            <div style={{ color: ins.delta_value >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
              {sign}{fmtNum(ins.delta_value)}
              {ins.delta_pct !== 0 && (
                <span style={{ color: 'var(--fg-3)', fontWeight: 400, marginLeft: 4 }}>
                  ({sign}{ins.delta_pct.toFixed(1)}%)
                </span>
              )}
            </div>
          </div>
        )}
        {ins.likely && ins.likely.length > 0 && (
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ color: 'var(--fg-3)', marginBottom: 4 }}>likely cause</div>
            <ul style={{ margin: 0, paddingLeft: 14, color: 'var(--fg)', lineHeight: 1.6 }}>
              {ins.likely.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// ── HParams ──────────────────────────────────────────────────────────────────

function HParamsTable({ report, onlyDiff }: { report: DiffReport; onlyDiff: boolean }) {
  const { changed, same, only_in } = report.hparams ?? { changed: {}, same: {}, only_in: {} }
  const runs = report.runs
  const n = runs.length

  const changedKeys = Object.keys(changed ?? {}).sort()
  const onlyInKeys = Object.keys(only_in ?? {}).sort()
  const sameKeys = Object.keys(same ?? {}).sort()

  if (changedKeys.length === 0 && onlyInKeys.length === 0 && (onlyDiff || sameKeys.length === 0)) {
    return <Empty title="(no hyperparameter differences)" />
  }

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={{ ...th, width: 20 }}></th>
          <th style={th}>param</th>
          {runs.map((r, i) => (
            <th key={r.id} style={th}>
              <span style={{ color: PALETTE[i % PALETTE.length] }}>{String.fromCharCode(65 + i)}</span> {r.id}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {changedKeys.map((k) => {
          const vals = changed[k]
          return (
            <tr key={k} style={{ background: 'var(--diff-edit)' }}>
              <td style={{ ...td, color: 'var(--warn)', fontWeight: 700 }}>*</td>
              <td style={{ ...td, color: 'var(--fg-2)' }}>{k}</td>
              {Array.from({ length: n }, (_, i) => (
                <td key={i} style={td}>{vals[i] == null ? '—' : String(vals[i])}</td>
              ))}
            </tr>
          )
        })}
        {onlyInKeys.map((k) => {
          const vals = changed[k] ?? []
          return (
            <tr key={k} style={{ background: 'var(--diff-add)' }}>
              <td style={{ ...td, color: 'var(--success)', fontWeight: 700 }}>+</td>
              <td style={{ ...td, color: 'var(--fg-2)' }}>{k}</td>
              {Array.from({ length: n }, (_, i) => (
                <td key={i} style={td}>{vals[i] == null ? '—' : String(vals[i])}</td>
              ))}
            </tr>
          )
        })}
        {!onlyDiff && sameKeys.map((k) => (
          <tr key={k}>
            <td style={td}></td>
            <td style={{ ...td, color: 'var(--fg-3)' }}>{k}</td>
            {Array.from({ length: n }, () => (
              <td style={td}>{same[k] == null ? '—' : String(same[k])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Final metrics ─────────────────────────────────────────────────────────────

function FinalTable({ report }: { report: DiffReport }) {
  const rows = report.metrics?.rows ?? []
  const runs = report.runs
  const n = runs.length

  if (!rows.length) return <Empty title="(no final metrics)" />

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>metric</th>
          {runs.map((r, i) => (
            <th key={r.id} style={th}>
              <span style={{ color: PALETTE[i % PALETTE.length] }}>{String.fromCharCode(65 + i)}</span> {r.id}
            </th>
          ))}
          {n === 2 && <th style={th}>delta</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const sign = row.delta >= 0 ? '+' : ''
          return (
            <tr key={row.name}>
              <td style={{ ...td, color: 'var(--fg-2)' }}>
                {row.name}
                <span style={{ color: 'var(--fg-4)', fontSize: 9, marginLeft: 4 }}>
                  {row.higher_better ? '▲' : '▼'}
                </span>
              </td>
              {Array.from({ length: n }, (_, i) => {
                const v = row.values[i]
                const isBest = i === row.best_idx
                return (
                  <td key={i} style={{ ...td, color: isBest ? 'var(--success)' : undefined, fontWeight: isBest ? 700 : 400 }}>
                    {v == null || isNaN(v) ? '—' : fmtNum(v)}
                  </td>
                )
              })}
              {n === 2 && (
                <td style={{ ...td, color: row.delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {row.delta == null || isNaN(row.delta) ? '—' : `${sign}${fmtNum(row.delta)}`}
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Metric overlay ────────────────────────────────────────────────────────────

function MetricOverlay({ runs, metricQueries }: { runs: DiffReport['runs']; metricQueries: MetricRow[][] }) {
  const names = useMemo(() => {
    const s = new Set<string>()
    metricQueries.forEach((rows) =>
      rows.forEach((r) => Object.keys(r.values).forEach((k) => s.add(k))),
    )
    return [...s].sort()
  }, [metricQueries])

  if (!names.length) return <Empty title="(no metric time series)" />

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
      {names.map((name) => {
        const series: Series[] = runs.map((r, i) => ({
          name: `[${String.fromCharCode(65 + i)}] ${r.id.slice(-6)}`,
          color: PALETTE[i % PALETTE.length],
          values: (metricQueries[i] || [])
            .filter((row) => name in row.values)
            .map((row) => ({ x: row.step, y: row.values[name] })),
        }))
        return (
          <div key={name}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)', marginBottom: 4 }}>{name}</div>
            <LineChart series={series} width={440} height={200} />
          </div>
        )
      })}
    </div>
  )
}

// ── Env / Hardware ────────────────────────────────────────────────────────────

function EnvHwTable({ report, onlyDiff }: { report: DiffReport; onlyDiff: boolean }) {
  const runs = report.runs
  const n = runs.length

  type Row = { key: string; vals: string[]; differs: boolean }
  const rows: Row[] = []

  const addSection = (
    prefix: string,
    changed: Record<string, string[]>,
    same: Record<string, string>,
  ) => {
    Object.keys(changed ?? {}).sort().forEach((k) => {
      rows.push({ key: `${prefix}.${k}`, vals: changed[k], differs: true })
    })
    if (!onlyDiff) {
      Object.keys(same ?? {}).sort().forEach((k) => {
        rows.push({ key: `${prefix}.${k}`, vals: Array.from({ length: n }, () => same[k]), differs: false })
      })
    }
  }

  addSection('env', report.env?.changed ?? {}, report.env?.same ?? {})
  addSection('hw', report.hardware?.changed ?? {}, report.hardware?.same ?? {})

  if (!rows.length) return <Empty title="(no env/hw info)" />

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>key</th>
          {runs.map((r, i) => (
            <th key={r.id} style={th}>
              <span style={{ color: PALETTE[i % PALETTE.length] }}>{String.fromCharCode(65 + i)}</span> {r.id}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} style={{ background: row.differs ? 'var(--diff-edit)' : undefined }}>
            <td style={{ ...td, color: 'var(--fg-3)' }}>{row.key}</td>
            {row.vals.map((v, i) => (
              <td key={i} style={td}>{v || '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Dataset ───────────────────────────────────────────────────────────────────

function DataTable({ report }: { report: DiffReport }) {
  const runs = report.runs
  const data = report.data
  if (!data) return null

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>field</th>
          {runs.map((r, i) => (
            <th key={r.id} style={th}>
              <span style={{ color: PALETTE[i % PALETTE.length] }}>{String.fromCharCode(65 + i)}</span> {r.id}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr style={{ background: data.same ? undefined : 'var(--diff-edit)' }}>
          <td style={{ ...td, color: 'var(--fg-3)' }}>dataset</td>
          {data.values.map((v, i) => (
            <td key={i} style={td}>{v || '—'}</td>
          ))}
        </tr>
        <tr style={{ background: data.same_hash ? undefined : 'var(--diff-edit)' }}>
          <td style={{ ...td, color: 'var(--fg-3)' }}>hash</td>
          {data.hashes.map((v, i) => (
            <td key={i} style={td}>{v ? v.slice(0, 12) : '—'}</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

type CSS = React.CSSProperties

const tableStyle: CSS = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11 }
const th: CSS = { padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--fg-3)', textAlign: 'left', fontWeight: 600 }
const td: CSS = { padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--fg)' }
