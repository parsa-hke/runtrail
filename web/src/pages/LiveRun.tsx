import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { fmtDuration, fmtNum, relTime } from '../lib/format'
import { Btn, Empty, KV, Panel, StatusBadge } from '../components/atoms'
import { LineChart, PALETTE, type Series } from '../components/charts'

export default function LiveRunPage({ runId }: { runId: string }) {
  const queryClient = useQueryClient()

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
  })
  const mutationsEnabled = health?.mutations ?? false

  const { data } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId),
  })
  const { data: metrics = [] } = useQuery({
    queryKey: ['metrics-live', runId],
    queryFn: () => api.getMetrics(runId),
  })
  const { data: logs } = useQuery({
    queryKey: ['logs', runId],
    queryFn: () => api.getLogs(runId, 'stdout', 200),
  })
  const { data: resources = [] } = useQuery({
    queryKey: ['resources-live', runId],
    queryFn: () => api.getResources(runId),
  })
  const { data: events = [] } = useQuery({
    queryKey: ['events-live', runId],
    queryFn: () => api.getEvents(runId, 0),
  })

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/runs/${runId}`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'metric') {
          queryClient.setQueryData(['metrics-live', runId], (old: any) => {
            const list = old ? [...old] : []
            // Deduplicate steps if needed, but append is fine
            list.push({ step: msg.step, wall_ms: msg.wall_ms, values: msg.values })
            return list
          })
        } else if (msg.type === 'resource') {
          queryClient.setQueryData(['resources-live', runId], (old: any) => {
            const list = old ? [...old] : []
            list.push(msg)
            return list
          })
        } else if (msg.type === 'event') {
          queryClient.setQueryData(['events-live', runId], (old: any) => {
            const list = old ? [...old] : []
            list.push(msg)
            return list
          })
        } else if (msg.type === 'log') {
          queryClient.setQueryData(['logs', runId], (old: any) => {
            const lines = old?.lines ? [...old.lines] : []
            lines.push(msg.text)
            return { stream: msg.stream, lines }
          })
        } else if (msg.type === 'status') {
          queryClient.invalidateQueries({ queryKey: ['run', runId] })
          queryClient.invalidateQueries({ queryKey: ['runs'] })
        }
      } catch (e) {
        console.error(e)
      }
    }

    return () => {
      ws.close()
    }
  }, [runId, queryClient])

  const handleStop = async () => {
    if (confirm('Are you sure you want to stop this training run?')) {
      try {
        await api.stopRun(runId)
        queryClient.invalidateQueries({ queryKey: ['run', runId] })
        queryClient.invalidateQueries({ queryKey: ['runs'] })
      } catch (err: any) {
        alert(err.message)
      }
    }
  }

  const metricNames = useMemo(() => {
    const s = new Set<string>()
    metrics.forEach((r) => Object.keys(r.values).forEach((k) => s.add(k)))
    return [...s].sort()
  }, [metrics])

  if (!data) return <Empty title="Loading…" />
  const run = data.run

  return (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 360px', gap: 12, padding: 16, overflow: 'hidden', minHeight: 0 }}>
      {/* Main column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', minHeight: 0 }}>
        <Panel
          title={
            <span>
              <StatusBadge status={run.status} />{' '}
              <span style={{ color: 'var(--accent)', marginLeft: 6 }}>{run.id}</span>{' '}
              <span style={{ color: 'var(--fg-2)', marginLeft: 6 }}>{run.name}</span>
            </span>
          }
          right={
            mutationsEnabled && run.status === 'running' ? (
              <Btn variant="danger" onClick={handleStop}>
                Stop Run
              </Btn>
            ) : null
          }
        >
          <div style={{ display: 'flex', gap: 24, fontFamily: 'var(--mono)', fontSize: 11 }}>
            <KV k="duration" v={fmtDuration(run.duration_s)} />
            <KV k="started" v={relTime(run.started_at)} />
            <KV k="pid" v={String(run.pid ?? '—')} />
          </div>
        </Panel>

        {metricNames.length === 0 ? (
          <Empty title="Waiting for first metrics…" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
            {metricNames.map((name, i) => {
              const series: Series[] = [
                {
                  name,
                  color: PALETTE[i % PALETTE.length],
                  values: metrics.filter((r) => name in r.values).map((r) => ({ x: r.step, y: r.values[name] })),
                },
              ]
              return (
                <Panel key={name} title={name}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--fg)', marginBottom: 6 }}>
                    {fmtNum(series[0].values[series[0].values.length - 1]?.y)}
                  </div>
                  <LineChart series={series} width={400} height={160} />
                </Panel>
              )
            })}
          </div>
        )}

        <Panel title="stdout (tail)" style={{ minHeight: 220 }}>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)', margin: 0, whiteSpace: 'pre-wrap' }}>
            {(logs?.lines ?? []).join('\n')}
          </pre>
        </Panel>
      </div>

      {/* Right rail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', minHeight: 0 }}>
        <Panel title="Resources">
          {resources.length === 0 ? (
            <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>—</span>
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              {(() => {
                const last = resources[resources.length - 1]
                return (
                  <>
                    <KV k="cpu_pct" v={fmtNum(Number(last.cpu_pct ?? NaN), 1)} />
                    <KV k="ram_pct" v={fmtNum(Number(last.ram_pct ?? NaN), 1)} />
                    <KV k="gpus" v={String(last.gpu_count ?? 0)} />
                  </>
                )
              })()}
            </div>
          )}
        </Panel>

        <Panel title="Events">
          {events.length === 0 ? (
            <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>—</span>
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)' }}>
              {events
                .slice(-50)
                .reverse()
                .map((e, i) => (
                  <div key={i} style={{ padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
                    <span
                      style={{
                        color:
                          e.level === 'error'
                            ? 'var(--danger)'
                            : e.level === 'warn'
                            ? 'var(--warn)'
                            : 'var(--info)',
                      }}
                    >
                      [{e.level}]
                    </span>{' '}
                    {e.message}
                  </div>
                ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
