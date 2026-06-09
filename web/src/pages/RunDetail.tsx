import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { MetricRow, Run } from '../api/types'
import { fmtBytes, fmtDuration, fmtNum, relTime } from '../lib/format'
import { Btn, Empty, KV, Panel, StatusBadge, Tag } from '../components/atoms'
import { LineChart, PALETTE, Sparkline, type Series } from '../components/charts'
import { navigate } from '../lib/router'

const TABS = ['overview', 'metrics', 'code', 'artifacts', 'resources', 'raw'] as const
type Tab = (typeof TABS)[number]

export default function RunDetailPage({ runId }: { runId: string }) {
  const [tab, setTab] = useState<Tab>('overview')
  const queryClient = useQueryClient()

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
  })
  const mutationsEnabled = health?.mutations ?? false

  const { data, isLoading, error } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId),
  })

  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState('')

  const run = data?.run
  const artifacts = data?.artifacts ?? []

  useEffect(() => {
    if (run) {
      setEditedName(run.name)
    }
  }, [run])

  if (isLoading) return <Empty title="Loading…" />
  if (error) return <Empty title="Error" hint={String(error)} />
  if (!data || !run) return <Empty title="Not found" />

  const handleTogglePin = async () => {
    try {
      await api.patchRun(runId, { pinned: !run.pinned })
      queryClient.invalidateQueries({ queryKey: ['run', runId] })
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleSaveName = async () => {
    setIsEditingName(false)
    if (editedName.trim() === '' || editedName === run.name) return
    try {
      await api.patchRun(runId, { name: editedName.trim() })
      queryClient.invalidateQueries({ queryKey: ['run', runId] })
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    } catch (e: any) {
      alert(e.message)
      setEditedName(run.name)
    }
  }

  const handleDelete = async () => {
    if (confirm(`Are you sure you want to delete run ${runId}? This cannot be undone.`)) {
      try {
        await api.deleteRun(runId)
        queryClient.invalidateQueries({ queryKey: ['runs'] })
        navigate('/')
      } catch (e: any) {
        alert(e.message)
      }
    }
  }

  const handleStop = async () => {
    if (confirm('Are you sure you want to stop this training run?')) {
      try {
        await api.stopRun(runId)
        queryClient.invalidateQueries({ queryKey: ['run', runId] })
        queryClient.invalidateQueries({ queryKey: ['runs'] })
      } catch (e: any) {
        alert(e.message)
      }
    }
  }

  const handlePatch = async (patch: any) => {
    try {
      await api.patchRun(runId, patch)
      queryClient.invalidateQueries({ queryKey: ['run', runId] })
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <StatusBadge status={run.status} />
        {mutationsEnabled ? (
          <button
            onClick={handleTogglePin}
            style={{
              background: 'none',
              border: 'none',
              color: run.pinned ? 'var(--accent)' : 'var(--fg-4)',
              cursor: 'pointer',
              fontSize: 16,
              padding: 0,
            }}
            title={run.pinned ? 'Unpin run' : 'Pin run'}
          >
            ★
          </button>
        ) : run.pinned ? (
          <span style={{ color: 'var(--accent)', fontSize: 16 }}>★</span>
        ) : null}
        <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 13 }}>{run.id}</span>
        
        {isEditingName ? (
          <input
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
            autoFocus
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              color: 'var(--fg)',
              fontFamily: 'var(--mono)',
              fontSize: 13,
              padding: '2px 6px',
            }}
          />
        ) : (
          <span
            onDoubleClick={() => mutationsEnabled && setIsEditingName(true)}
            style={{
              color: 'var(--fg)',
              fontFamily: 'var(--mono)',
              fontSize: 13,
              fontWeight: 600,
              cursor: mutationsEnabled ? 'pointer' : 'default',
            }}
            title={mutationsEnabled ? 'Double click to rename' : undefined}
          >
            {run.name}
            {mutationsEnabled && (
              <span
                onClick={() => setIsEditingName(true)}
                style={{ marginLeft: 6, color: 'var(--fg-4)', fontSize: 10, cursor: 'pointer' }}
              >
                ✎
              </span>
            )}
          </span>
        )}

        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
          {fmtDuration(run.duration_s)} · {relTime(run.started_at)}
        </span>

        {mutationsEnabled && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
            {run.status === 'running' && (
              <Btn variant="danger" onClick={handleStop}>Stop</Btn>
            )}
            <Btn variant="default" onClick={handleDelete} style={{ color: 'var(--danger)', borderColor: 'var(--danger)33' }}>
              Delete
            </Btn>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 14px',
              background: tab === t ? 'var(--surface)' : 'transparent',
              border: 'none',
              borderRight: '1px solid var(--border)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--accent)' : 'var(--fg-2)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <span style={{ color: 'var(--fg-4)', marginRight: 6 }}>{i + 1}</span>
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {tab === 'overview' && <OverviewTab run={run} mutationsEnabled={mutationsEnabled} onPatch={handlePatch} />}
        {tab === 'metrics' && <MetricsTab runId={run.id} />}
        {tab === 'code' && <CodeTab runId={run.id} />}
        {tab === 'artifacts' && <ArtifactsTab runId={run.id} artifacts={artifacts} />}
        {tab === 'resources' && <ResourcesTab runId={run.id} />}
        {tab === 'raw' && <RawTab runId={run.id} />}
      </div>
    </div>
  )
}

// ─── Overview ───────────────────────────────────────────────────────────────

function OverviewTab({
  run,
  mutationsEnabled,
  onPatch,
}: {
  run: Run
  mutationsEnabled: boolean
  onPatch: (patch: any) => void
}) {
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState(run.notes || '')
  const [newTag, setNewTag] = useState('')

  useEffect(() => {
    setNotesText(run.notes || '')
  }, [run.notes])

  const saveNotes = () => {
    onPatch({ notes: notesText })
    setIsEditingNotes(false)
  }

  const removeTag = (tagToRemove: string) => {
    const nextTags = run.tags.filter((t) => t !== tagToRemove)
    onPatch({ tags: nextTags })
  }

  const addTag = () => {
    const tag = newTag.trim()
    if (!tag) return
    if (run.tags.includes(tag)) {
      setNewTag('')
      return
    }
    const nextTags = [...run.tags, tag]
    onPatch({ tags: nextTags })
    setNewTag('')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
      <Panel title="Run">
        <KV k="id" v={run.id} />
        <KV k="name" v={run.name} />
        <KV k="project" v={run.project_id} />
        <KV k="status" v={<StatusBadge status={run.status} />} />
        <KV k="started" v={new Date(run.started_at).toLocaleString()} />
        <KV k="ended" v={run.ended_at ? new Date(run.ended_at).toLocaleString() : '—'} />
        <KV k="duration" v={fmtDuration(run.duration_s)} />
        <KV k="user@host" v={`${run.user || '—'}@${run.host || '—'}`} />
        <KV k="pid" v={String(run.pid ?? '—')} />
        <KV k="cmd" v={run.cmd || '—'} />
        <KV k="commit" v={run.commit ? `${run.branch || ''} @ ${run.commit.slice(0, 8)}${run.dirty ? ' (dirty)' : ''}` : '—'} />
        
        <KV
          k="tags"
          v={
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
              {run.tags.map((t) => (
                <Tag key={t}>
                  {t}
                  {mutationsEnabled && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        removeTag(t)
                      }}
                      style={{
                        marginLeft: 6,
                        cursor: 'pointer',
                        color: 'var(--danger)',
                        fontWeight: 'bold',
                      }}
                    >
                      ×
                    </span>
                  )}
                </Tag>
              ))}
              {mutationsEnabled && (
                <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
                  <input
                    placeholder="add tag…"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTag()}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      color: 'var(--fg)',
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      padding: '1px 6px',
                      width: 80,
                    }}
                  />
                  <Btn variant="default" onClick={addTag} style={{ padding: '1px 6px', fontSize: 10 }}>
                    +
                  </Btn>
                </div>
              )}
              {!run.tags.length && !mutationsEnabled && '—'}
            </div>
          }
        />

        <KV
          k="notes"
          v={
            isEditingNotes ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: 60,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--fg)',
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    padding: 6,
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn variant="accent" onClick={saveNotes}>
                    Save
                  </Btn>
                  <Btn variant="default" onClick={() => setIsEditingNotes(false)}>
                    Cancel
                  </Btn>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{run.notes || '—'}</span>
                {mutationsEnabled && (
                  <Btn variant="default" onClick={() => setIsEditingNotes(true)} style={{ padding: '2px 6px', fontSize: 10 }}>
                    Edit
                  </Btn>
                )}
              </div>
            )
          }
        />
        {run.error && <KV k="error" v={<span style={{ color: 'var(--danger)' }}>{run.error}</span>} />}
      </Panel>

      <Panel title="Final metrics">
        {Object.keys(run.final).length === 0 ? (
          <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>—</span>
        ) : (
          Object.entries(run.final)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => <KV key={k} k={k} v={fmtNum(v)} />)
        )}
      </Panel>

      <Panel title="Hyperparameters">
        {Object.keys(run.hparams).length === 0 ? (
          <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>—</span>
        ) : (
          Object.entries(run.hparams)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => <KV key={k} k={k} v={String(v)} />)
        )}
      </Panel>

      <Panel title="Hardware & environment">
        {run.hardware && Object.entries(run.hardware).map(([k, v]) => (
          <KV key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
        ))}
        {run.env && Object.entries(run.env).map(([k, v]) => (
          <KV key={`env-${k}`} k={`env.${k}`} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
        ))}
      </Panel>
    </div>
  )
}

// ─── Metrics ────────────────────────────────────────────────────────────────

function MetricsTab({ runId }: { runId: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['metrics', runId],
    queryFn: () => api.getMetrics(runId),
  })

  const metricNames = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((r) => Object.keys(r.values).forEach((k) => set.add(k)))
    return [...set].sort()
  }, [rows])

  if (isLoading) return <Empty title="Loading metrics…" />
  if (!rows.length) return <Empty title="No metrics yet" />

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
      {metricNames.map((name, i) => {
        const series: Series[] = [
          {
            name,
            color: PALETTE[i % PALETTE.length],
            values: rows
              .filter((r) => name in r.values)
              .map((r: MetricRow) => ({ x: r.step, y: r.values[name] })),
          },
        ]
        return (
          <Panel key={name} title={name}>
            <LineChart series={series} width={440} height={200} />
          </Panel>
        )
      })}
    </div>
  )
}

// ─── Code ───────────────────────────────────────────────────────────────────

function CodeTab({ runId }: { runId: string }) {
  const { data: tree = [] } = useQuery({
    queryKey: ['tree', runId],
    queryFn: () => api.sourceTree(runId),
  })
  const [path, setPath] = useState<string | null>(null)
  const selectedPath = path ?? tree[0] ?? null

  const { data: file } = useQuery({
    queryKey: ['file', runId, selectedPath],
    queryFn: () => api.sourceFile(runId, selectedPath!),
    enabled: !!selectedPath,
  })

  if (!tree.length) {
    return (
      <Empty
        title="No source snapshot"
        hint="The run started from a clean git commit, or capture_source was disabled."
      />
    )
  }
  return (
    <div style={{ display: 'flex', gap: 12, minHeight: 480 }}>
      <Panel title={`Files (${tree.length})`} style={{ width: 240, overflow: 'auto' }}>
        {tree.map((f) => (
          <button
            key={f}
            onClick={() => setPath(f)}
            style={{
              display: 'block',
              width: '100%',
              padding: '4px 6px',
              textAlign: 'left',
              background: f === selectedPath ? 'var(--accent-soft)' : 'transparent',
              color: f === selectedPath ? 'var(--accent)' : 'var(--fg-2)',
              border: 'none',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {f}
          </button>
        ))}
      </Panel>
      <Panel title={selectedPath || ''} style={{ flex: 1, overflow: 'auto' }}>
        <pre
          style={{
            margin: 0,
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--fg)',
            whiteSpace: 'pre',
          }}
        >
          {file?.content ?? ''}
        </pre>
      </Panel>
    </div>
  )
}

// ─── Artifacts ──────────────────────────────────────────────────────────────

function ArtifactsTab({ runId, artifacts }: { runId: string; artifacts: import('../api/types').Artifact[] }) {
  if (!artifacts.length) return <Empty title="No artifacts" />
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11 }}>
      <thead>
        <tr style={{ color: 'var(--fg-3)', textAlign: 'left' }}>
          <th style={cell}>NAME</th>
          <th style={cell}>TYPE</th>
          <th style={cell}>SIZE</th>
          <th style={cell}>SHA256</th>
          <th style={cell}></th>
        </tr>
      </thead>
      <tbody>
        {artifacts.map((a) => (
          <tr key={a.name}>
            <td style={cell}>{a.name}</td>
            <td style={cell}>{a.type}</td>
            <td style={cell}>{fmtBytes(a.size_bytes)}</td>
            <td style={{ ...cell, color: 'var(--fg-3)' }}>{a.sha256.slice(0, 16)}…</td>
            <td style={cell}>
              <a
                href={api.artifactURL(runId, a.name)}
                style={{ color: 'var(--info)', fontFamily: 'var(--mono)', fontSize: 11 }}
              >
                download
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const cell: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--fg)',
}

// ─── Resources ──────────────────────────────────────────────────────────────

function ResourcesTab({ runId }: { runId: string }) {
  const { data: samples = [] } = useQuery({
    queryKey: ['resources', runId],
    queryFn: () => api.getResources(runId),
  })
  if (!samples.length) return <Empty title="No resource samples" hint="resource_interval was 0 or the run was too short" />

  const cpu = samples.map((s, i) => ({ x: i, y: Number(s.cpu_pct ?? 0) }))
  const ram = samples.map((s, i) => ({ x: i, y: Number(s.ram_pct ?? 0) }))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
      <Panel title="CPU %"><LineChart series={[{ name: 'cpu', color: 'var(--info)', values: cpu }]} width={440} height={200} xLabel="sample" /></Panel>
      <Panel title="RAM %"><LineChart series={[{ name: 'ram', color: 'var(--purple)', values: ram }]} width={440} height={200} xLabel="sample" /></Panel>
      <Panel title="Sparklines">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--mono)', fontSize: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--fg-3)', minWidth: 60 }}>cpu</span>
            <Sparkline values={cpu.map((p) => p.y)} width={200} color="var(--info)" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--fg-3)', minWidth: 60 }}>ram</span>
            <Sparkline values={ram.map((p) => p.y)} width={200} color="var(--purple)" />
          </div>
        </div>
      </Panel>
    </div>
  )
}

// ─── Raw ────────────────────────────────────────────────────────────────────

function RawTab({ runId }: { runId: string }) {
  const { data } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId),
  })
  return (
    <Panel title="raw JSON">
      <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </Panel>
  )
}
