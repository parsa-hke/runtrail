import { useEffect, useMemo, useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Run } from '../api/types'
import { fmtDuration, fmtNum, relTime } from '../lib/format'
import { navigate } from '../lib/router'
import { Btn, Empty, Tag, StatusDot, KBD } from '../components/atoms'
import { Sparkline } from '../components/charts'
import { I } from '../components/icons'

export default function RunListPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isCreatingView, setIsCreatingView] = useState(false)
  const [newViewName, setNewViewName] = useState('')

  // Layout states
  const [collapsed, setCollapsed] = useState(false)
  const [rightRail, setRightRail] = useState(true)
  const [density, setDensity] = useState<'compact' | 'comfy'>('compact')
  const [hideSpark, setHideSpark] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activeIdx, setActiveIdx] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const queryClient = useQueryClient()

  // 1. Fetch health for mutation mode state
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
  })
  const mutationsEnabled = health?.mutations ?? false

  // 2. Fetch projects
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.listProjects(),
  })

  // 3. Keep active project state
  const [activeProjectId, setActiveProjectId] = useState<string>(() => localStorage.getItem('rt:active_project') || '')

  const activeProject = useMemo(() => {
    if (!projects.length) return null
    return projects.find((p) => p.id === activeProjectId) || projects[0]
  }, [projects, activeProjectId])

  useEffect(() => {
    if (activeProject && activeProject.id !== activeProjectId) {
      setActiveProjectId(activeProject.id)
      localStorage.setItem('rt:active_project', activeProject.id)
    }
  }, [activeProject, activeProjectId])

  // 4. Fetch saved views for project
  const { data: savedViews = [] } = useQuery({
    queryKey: ['saved_views', activeProject?.id],
    queryFn: () => api.listSavedViews(activeProject?.id || undefined),
    enabled: !!activeProject?.id,
  })

  // 5. Fetch runs for active project
  const { data: runs = [], isLoading, error } = useQuery({
    queryKey: ['runs', activeProject?.id],
    queryFn: () => api.listRuns({ project: activeProject?.id || undefined, limit: 500 }),
    enabled: !!activeProject?.id,
  })

  // WebSocket Live Updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/runs`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        queryClient.invalidateQueries({ queryKey: ['runs'] })
        if (msg.id) {
          queryClient.invalidateQueries({ queryKey: ['run', msg.id] })
        }
      } catch (e) {
        console.error('WS error:', e)
      }
    }

    return () => {
      ws.close()
    }
  }, [queryClient])

  // Client-side filtering & sorting
  const filtered = useMemo(() => {
    let list = runs
    if (statusFilter) {
      list = list.filter((r) => r.status === statusFilter)
    }
    if (tagFilter) {
      list = list.filter((r) => r.tags.includes(tagFilter))
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [runs, statusFilter, tagFilter, search])

  // Sorting
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'started', dir: 'desc' })

  const sorted = useMemo(() => {
    const list = [...filtered]
    const cmp = (a: Run, b: Run) => {
      let av: any, bv: any
      if (sort.col === 'name') {
        av = a.name
        bv = b.name
      } else if (sort.col === 'started') {
        av = new Date(a.started_at).getTime()
        bv = new Date(b.started_at).getTime()
      } else if (sort.col === 'duration') {
        av = a.duration_s
        bv = b.duration_s
      } else if (sort.col === 'val_acc') {
        av = a.final?.val_acc ?? a.final?.accuracy ?? a.final?.acc ?? -1
        bv = b.final?.val_acc ?? b.final?.accuracy ?? b.final?.acc ?? -1
      } else if (sort.col === 'val_loss') {
        av = a.final?.val_loss ?? a.final?.loss ?? Infinity
        bv = b.final?.val_loss ?? b.final?.loss ?? Infinity
      } else {
        av = (a as any)[sort.col]
        bv = (b as any)[sort.col]
      }
      return av > bv ? 1 : av < bv ? -1 : 0
    }
    list.sort((a, b) => (sort.dir === 'asc' ? cmp(a, b) : -cmp(a, b)))
    return list
  }, [filtered, sort])

  const toggleSort = (col: string) => {
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }))
  }

  const liveRuns = useMemo(() => runs.filter((r) => r.status === 'running'), [runs])

  const statusCounts = useMemo(() => {
    const counts = { running: 0, done: 0, failed: 0, killed: 0 }
    runs.forEach((r) => {
      if (r.status in counts) {
        counts[r.status as keyof typeof counts]++
      }
    })
    return counts
  }, [runs])

  const tags = useMemo(() => {
    const map = new Map<string, number>()
    runs.forEach((r) => {
      ;(r.tags || []).forEach((t) => {
        map.set(t, (map.get(t) || 0) + 1)
      })
    })
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [runs])

  const baselines = useMemo(() => {
    if (!activeProject) return []
    return (activeProject.baselines || []).map((id) => runs.find((r) => r.id === id)).filter(Boolean) as Run[]
  }, [activeProject, runs])

  // Key navigation logic
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }

      if (e.key === 'j') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(sorted.length - 1, i + 1))
      }
      if (e.key === 'k') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
      }
      if (e.key === 'x') {
        e.preventDefault()
        const run = sorted[activeIdx]
        if (run) {
          toggle(run.id)
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const run = sorted[activeIdx]
        if (run) {
          navigate(run.status === 'running' ? `/live/${run.id}` : `/runs/${run.id}`)
        }
      }
      if (e.key === 'c') {
        if (selected.size >= 2) {
          e.preventDefault()
          openDiff()
        }
      }
      if (e.key === 'p') {
        const run = sorted[activeIdx]
        if (run) {
          e.preventDefault()
          handlePinRun(run.id)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sorted, activeIdx, selected])

  const handlePinRun = async (runId: string) => {
    if (!activeProject) return
    const isPinned = activeProject.baselines?.includes(runId)
    const nextBaselines = isPinned
      ? activeProject.baselines.filter((id) => id !== runId)
      : [...(activeProject.baselines || []), runId]

    try {
      await api.patchProject(activeProject.id, { baselines: nextBaselines })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    } catch (err: any) {
      alert('Failed to pin baseline: ' + err.message)
    }
  }

  const selectStatus = (status: string) => {
    setStatusFilter(status)
    setActiveSavedViewId(null)
  }

  const selectTag = (tag: string) => {
    setTagFilter(tagFilter === tag ? '' : tag)
    setActiveSavedViewId(null)
  }

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setActiveSavedViewId(null)
  }

  const applySavedView = (view: any) => {
    setActiveSavedViewId(view.id)
    const params = new URLSearchParams(view.query)
    setStatusFilter(params.get('status') || '')
    setTagFilter(params.get('tag') || '')
    setSearch(params.get('search') || '')
  }

  const handleSaveView = async () => {
    if (!activeProject || !newViewName.trim()) return
    const viewId = 'view-' + Math.random().toString(36).substring(2, 11)
    const queryStr = new URLSearchParams({
      status: statusFilter,
      tag: tagFilter,
      search: search,
    }).toString()

    try {
      await api.saveView({
        id: viewId,
        project_id: activeProject.id,
        name: newViewName.trim(),
        query: queryStr,
      })
      setIsCreatingView(false)
      setNewViewName('')
      queryClient.invalidateQueries({ queryKey: ['saved_views', activeProject.id] })
    } catch (err: any) {
      alert('Failed to save view: ' + err.message)
    }
  }

  const handleDeleteView = async (e: React.MouseEvent, viewId: string) => {
    e.stopPropagation()
    if (!activeProject) return
    if (!confirm('Are you sure you want to delete this saved view?')) return
    try {
      await api.deleteView(viewId, activeProject.id)
      if (activeSavedViewId === viewId) {
        setActiveSavedViewId(null)
      }
      queryClient.invalidateQueries({ queryKey: ['saved_views', activeProject.id] })
    } catch (err: any) {
      alert('Failed to delete view: ' + err.message)
    }
  }

  const toggle = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openDiff = () => {
    const ids = [...selected]
    if (ids.length >= 2) navigate(`/diff?ids=${ids.join(',')}`)
  }

  const allChecked = sorted.length > 0 && sorted.every((r) => selected.has(r.id))
  const someChecked = !allChecked && sorted.some((r) => selected.has(r.id))

  const rowH = density === 'compact' ? 30 : 38

  const cols = [
    { key: 'check', w: 28 },
    { key: 'status', label: '', w: 14 },
    { key: 'name', label: 'run', flex: 1 },
    { key: 'tags', label: 'tags', w: 180 },
    { key: 'spark', label: 'val_loss · val_acc', w: hideSpark ? 0 : 200 },
    { key: 'val_acc', label: 'val_acc', w: 80, num: true },
    { key: 'val_loss', label: 'val_loss', w: 80, num: true },
    { key: 'duration', label: 'duration', w: 80, num: true },
    { key: 'started', label: 'started', w: 110, num: true },
    { key: 'actions', w: 80 },
  ].filter((c) => c.w !== 0)

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, flexDirection: 'column' }}>
      {/* Sub-toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-2)',
        }}
      >
        <IconBtn icon={I.list} title="Toggle sidebar" onClick={() => setCollapsed(!collapsed)} active={!collapsed} />

        {projects.length > 0 && (
          <ProjectSelect
            value={activeProjectId}
            onChange={(val) => {
              setActiveProjectId(val)
              localStorage.setItem('rt:active_project', val)
            }}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}

        <div style={{ width: 1, height: 18, background: 'var(--border-2)' }} />

        <div style={{ flex: 1, maxWidth: 360, position: 'relative' }}>
          <input
            ref={searchRef}
            id="run-search-input"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="filter runs by name, id, tag…"
            style={{
              width: '100%',
              height: 26,
              padding: '0 8px 0 28px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-2)',
              borderRadius: 3,
              color: 'var(--fg)',
              outline: 'none',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'13\' height=\'13\' viewBox=\'0 0 16 16\' fill=\'none\'><circle cx=\'7\' cy=\'7\' r=\'4.5\' stroke=\'%23777\' stroke-width=\'1.3\'/><path d=\'M10.5 10.5L14 14\' stroke=\'%23777\' stroke-width=\'1.3\' stroke-linecap=\'round\'/></svg>")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: '8px center',
            }}
          />
        </div>

        <Btn variant={selected.size >= 2 ? 'accent' : 'default'} disabled={selected.size < 2} onClick={openDiff}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {I.compare} Compare ({selected.size})
          </span>
        </Btn>

        <span style={{ flex: 1 }} />

        <Btn variant={!hideSpark ? 'accent' : 'default'} onClick={() => setHideSpark(!hideSpark)}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {I.bars} Spark
          </span>
        </Btn>
      </div>

      {/* Active Filter Chips */}
      {(statusFilter || tagFilter || search) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--mono)' }}>filter:</span>
          {statusFilter && (
            <FilterChip label={`status = ${statusFilter}`} onRemove={() => selectStatus('')} />
          )}
          {tagFilter && (
            <FilterChip label={`tag = #${tagFilter}`} onRemove={() => selectTag(tagFilter)} />
          )}
          {search && (
            <FilterChip label={`search = "${search}"`} onRemove={() => handleSearchChange('')} />
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--mono)' }}>
            {sorted.length}/{runs.length} runs
          </span>
        </div>
      )}

      {/* Sidebar + Table area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left Sidebar */}
        {!collapsed && (
          <aside
            style={{
              width: 230,
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-2)',
              display: 'flex',
              flexDirection: 'column',
              flex: '0 0 230px',
              fontFamily: 'var(--mono)',
              fontSize: 11.5,
              overflow: 'hidden',
            }}
          >
            <div style={{ flex: 1, padding: '12px 14px 4px', overflowY: 'auto' }}>
              {/* Saved Views Section */}
              <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
                Saved views
              </div>
              <div style={{ padding: '0 0 12px' }}>
                {savedViews.map((v) => (
                  <div
                    key={v.id}
                    onClick={() => applySavedView(v)}
                    className="row-hover"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '4px 8px',
                      borderRadius: 3,
                      cursor: 'pointer',
                      background: activeSavedViewId === v.id ? 'var(--accent-soft)' : 'transparent',
                      color: activeSavedViewId === v.id ? 'var(--accent)' : 'var(--fg-2)',
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.name}
                    </span>
                    {mutationsEnabled && (
                      <button
                        onClick={(e) => handleDeleteView(e, v.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          opacity: 0.6,
                          padding: '0 4px',
                          fontSize: 12,
                        }}
                        title="Delete view"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {mutationsEnabled && (
                  isCreatingView ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 8px' }}>
                      <input
                        placeholder="view name…"
                        value={newViewName}
                        onChange={(e) => setNewViewName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveView()}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 3,
                          color: 'var(--fg)',
                          fontFamily: 'var(--mono)',
                          fontSize: 10,
                          padding: '2px 6px',
                        }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={handleSaveView}
                          style={{
                            flex: 1,
                            padding: '2px 4px',
                            background: 'var(--accent-soft)',
                            color: 'var(--accent)',
                            border: '1px solid var(--accent)',
                            borderRadius: 2,
                            fontSize: 9,
                            cursor: 'pointer',
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setIsCreatingView(false)}
                          style={{
                            flex: 1,
                            padding: '2px 4px',
                            background: 'var(--surface-3)',
                            border: '1px solid var(--border)',
                            borderRadius: 2,
                            fontSize: 9,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsCreatingView(true)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '4px 8px',
                        background: 'transparent',
                        border: '1px dashed var(--border-2)',
                        borderRadius: 3,
                        color: 'var(--fg-4)',
                        cursor: 'pointer',
                        fontSize: 10,
                        fontFamily: 'var(--mono)',
                        marginTop: 4,
                      }}
                    >
                      + Save current view
                    </button>
                  )
                )}
              </div>

              {/* Status Section */}
              <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 6 }}>
                Status
              </div>
              <div style={{ padding: '0 0 12px' }}>
                <FilterBtn label="All" active={!statusFilter} onClick={() => selectStatus('')} count={runs.length} />
                <FilterBtn label="Running" active={statusFilter === 'running'} onClick={() => selectStatus('running')} count={statusCounts.running} dot="running" />
                <FilterBtn label="Done" active={statusFilter === 'done'} onClick={() => selectStatus('done')} count={statusCounts.done} dot="done" />
                <FilterBtn label="Failed" active={statusFilter === 'failed'} onClick={() => selectStatus('failed')} count={statusCounts.failed} dot="failed" />
                <FilterBtn label="Killed" active={statusFilter === 'killed'} onClick={() => selectStatus('killed')} count={statusCounts.killed} dot="killed" />
              </div>

              {/* Tags Section */}
              {tags.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 6 }}>
                    Tags
                  </div>
                  <div style={{ padding: '0 0 12px' }}>
                    {tags.map(([t, count]) => (
                      <button
                        key={t}
                        onClick={() => selectTag(t)}
                        style={{
                          display: 'flex',
                          width: '100%',
                          alignItems: 'center',
                          padding: '4px 8px',
                          background: tagFilter === t ? 'var(--accent-soft)' : 'transparent',
                          color: tagFilter === t ? 'var(--accent)' : 'var(--fg-2)',
                          border: '1px solid ' + (tagFilter === t ? 'var(--accent)' : 'transparent'),
                          borderRadius: 3,
                          fontFamily: 'inherit',
                          fontSize: 11,
                          cursor: 'pointer',
                          marginBottom: 2,
                        }}
                      >
                        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          #{t}
                        </span>
                        <span style={{ color: 'var(--fg-4)', fontSize: 10 }}>{count}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Pinned Baselines Section */}
              {baselines.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 6 }}>
                    Pinned baselines
                  </div>
                  <div style={{ padding: '0 0 12px' }}>
                    {baselines.map((b) => (
                      <div
                        key={b.id}
                        onClick={() => navigate(`/runs/${b.id}`)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 8px',
                          borderRadius: 3,
                          cursor: 'pointer',
                          fontSize: 11,
                          color: 'var(--fg-2)',
                        }}
                        className="row-hover"
                      >
                        <span style={{ color: 'var(--accent)' }}>📌</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {b.name}
                        </span>
                        <span style={{ color: 'var(--fg-4)', fontSize: 10 }}>
                          {b.final?.val_acc != null ? (b.final.val_acc * 100).toFixed(1) + '%' : b.id}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Project Path Footer */}
            {activeProject?.path && (
              <div
                style={{
                  padding: '10px 14px',
                  borderTop: '1px solid var(--border)',
                  fontFamily: 'var(--mono)',
                  fontSize: 10,
                  color: 'var(--fg-3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'var(--bg-2)',
                }}
              >
                <span style={{ color: 'var(--fg-4)', display: 'inline-flex' }}>{I.folder}</span>
                <span
                  title={activeProject.path}
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {activeProject.path}
                </span>
              </div>
            )}
          </aside>
        )}

        {/* Runs Table Column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
            {isLoading && <Empty title="Loading…" />}
            {error && <Empty title="Error" hint={String(error)} />}
            {!isLoading && sorted.length === 0 && (
              <Empty
                title="No runs yet"
                hint="Run a training script with `runtrail.init()` to see it here."
              />
            )}
            {!isLoading && sorted.length > 0 && (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'separate',
                  borderSpacing: 0,
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ background: 'var(--bg-2)', position: 'sticky', top: 0, zIndex: 1 }}>
                    {cols.map((c) => (
                      <th
                        key={c.key}
                        style={{
                          position: 'sticky',
                          top: 0,
                          textAlign: c.num ? 'right' : 'left',
                          padding: c.key === 'check' ? '0 6px 0 14px' : '0 10px',
                          height: 28,
                          fontWeight: 500,
                          fontSize: 10.5,
                          color: 'var(--fg-3)',
                          textTransform: 'uppercase',
                          letterSpacing: 0.6,
                          borderBottom: '1px solid var(--border)',
                          background: 'var(--bg-2)',
                          width: c.w,
                          minWidth: c.w,
                          cursor: ['name', 'duration', 'started', 'val_acc', 'val_loss'].includes(c.key) ? 'pointer' : 'default',
                          userSelect: 'none',
                        }}
                        onClick={() => ['name', 'duration', 'started', 'val_acc', 'val_loss'].includes(c.key) && toggleSort(c.key)}
                      >
                        {c.key === 'check' ? (
                          <Checkbox
                            checked={allChecked}
                            indeterminate={someChecked}
                            onChange={(v) => setSelected(v ? new Set(sorted.map((r) => r.id)) : new Set())}
                          />
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {c.label}
                            {sort.col === c.key && (
                              <span style={{ color: 'var(--accent)' }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.flatMap((r, idx) => {
                    const items = [
                      <RunRow
                        key={r.id}
                        run={r}
                        isActive={idx === activeIdx}
                        isSelected={selected.has(r.id)}
                        onSelect={() => toggle(r.id)}
                        onFocus={() => setActiveIdx(idx)}
                        onOpen={() => navigate(r.status === 'running' ? `/live/${r.id}` : `/runs/${r.id}`)}
                        onToggleExpand={() => {
                          setExpanded((prev) => {
                            const next = new Set(prev)
                            if (next.has(r.id)) next.delete(r.id)
                            else next.add(r.id)
                            return next
                          })
                        }}
                        expanded={expanded.has(r.id)}
                        hideSpark={hideSpark}
                        rowH={rowH}
                        onPin={() => handlePinRun(r.id)}
                        isPinned={activeProject?.baselines?.includes(r.id) ?? false}
                      />,
                    ]
                    if (expanded.has(r.id)) {
                      items.push(<RunRowExpanded key={r.id + '-x'} run={r} cols={cols} />)
                    }
                    return items
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Sidebar (Live Rail) */}
        {rightRail && <LiveRail liveRuns={liveRuns} onClose={() => setRightRail(false)} />}
        {!rightRail && (
          <button
            onClick={() => setRightRail(true)}
            style={{
              width: 26,
              borderLeft: '1px solid var(--border)',
              background: 'var(--bg-2)',
              color: 'var(--fg-3)',
              fontFamily: 'var(--mono)',
              fontSize: 10,
              writingMode: 'vertical-rl',
              padding: '12px 0',
              cursor: 'pointer',
              borderTop: 'none',
              borderRight: 'none',
              borderBottom: 'none',
              outline: 'none',
            }}
          >
            LIVE RUNS · {liveRuns.length}
          </button>
        )}
      </div>

      {/* Footer */}
      <Footer
        projectStorage={(activeProject as any)?.storage ?? 0}
        projectPath={activeProject?.path ?? ''}
        totalRuns={runs.length}
        visibleRuns={sorted.length}
        density={density}
        setDensity={setDensity}
      />
    </div>
  )
}

// ─── Inline components ──────────────────────────────────────────────────────

function ProjectSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (val: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 26,
        padding: '0 6px 0 8px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border-2)',
        borderRadius: 3,
        color: 'var(--fg)',
        fontFamily: 'var(--mono)',
        fontSize: 12,
        gap: 6,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <span style={{ color: 'var(--fg-3)', display: 'inline-flex' }}>{I.folder}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'inherit',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          paddingRight: 14,
          cursor: 'pointer',
          flex: 1,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
            {o.label}
          </option>
        ))}
      </select>
      <span style={{ color: 'var(--fg-3)', position: 'absolute', right: 6, pointerEvents: 'none', display: 'inline-flex' }}>
        {I.chevD}
      </span>
    </div>
  )
}

function IconBtn({
  icon,
  title,
  onClick,
  active,
}: {
  icon: React.ReactNode
  title: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 26,
        height: 26,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-2)',
        border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
        borderRadius: 3,
        cursor: 'pointer',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--hover)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      {icon}
    </button>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 22,
        padding: '0 4px 0 8px',
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        border: '1px solid var(--accent)',
        borderRadius: 2,
        fontFamily: 'var(--mono)',
        fontSize: 11,
      }}
    >
      <span>{label}</span>
      <button
        onClick={onRemove}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          padding: '0 4px',
          cursor: 'pointer',
          fontSize: 12,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        ×
      </button>
    </div>
  )
}

function Checkbox({
  checked,
  onChange,
  indeterminate,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  indeterminate?: boolean
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      style={{
        width: 14,
        height: 14,
        padding: 0,
        background: checked ? 'var(--accent)' : 'var(--surface-2)',
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 2,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 14px',
        cursor: 'pointer',
      }}
    >
      {checked && !indeterminate && (
        <svg width="9" height="9" viewBox="0 0 10 10">
          <path d="M1.5 5.2L4 7.6L8.5 2.5" stroke="#1c1408" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && <span style={{ width: 6, height: 1.5, background: 'var(--fg-3)' }} />}
    </button>
  )
}

// ─── Table row components ───────────────────────────────────────────────────

function RunRow({
  run,
  isActive,
  isSelected,
  onSelect,
  onFocus,
  onOpen,
  onToggleExpand,
  expanded,
  hideSpark,
  rowH,
  onPin,
  isPinned,
}: {
  run: Run
  isActive: boolean
  isSelected: boolean
  onSelect: () => void
  onFocus: () => void
  onOpen: () => void
  onToggleExpand: () => void
  expanded: boolean
  hideSpark: boolean
  rowH: number
  onPin: () => void
  isPinned: boolean
}) {
  const { data: metrics = [] } = useQuery({
    queryKey: ['metrics-spark', run.id],
    queryFn: () => api.getMetrics(run.id),
    staleTime: 30_000,
  })

  const lossSeries = useMemo(() => {
    const out: number[] = []
    for (const r of metrics) {
      const v = r.values['loss'] ?? r.values['train_loss'] ?? r.values['val_loss']
      if (typeof v === 'number') out.push(v)
    }
    return out
  }, [metrics])

  const accSeries = useMemo(() => {
    const out: number[] = []
    for (const r of metrics) {
      const v = r.values['val_acc'] ?? r.values['accuracy'] ?? r.values['acc']
      if (typeof v === 'number') out.push(v)
    }
    return out
  }, [metrics])

  const final = run.final['val_acc'] ?? run.final['accuracy'] ?? run.final['acc'] ?? undefined
  const finalLoss = run.final['val_loss'] ?? run.final['loss'] ?? undefined

  return (
    <tr
      className="row-hover"
      onClick={onFocus}
      onDoubleClick={onOpen}
      style={{
        height: rowH,
        background: isActive ? 'var(--surface-2)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
      }}
    >
      {/* Checkbox column */}
      <td style={{ padding: '0 6px 0 14px', verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Checkbox checked={isSelected} onChange={onSelect} />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            style={{
              width: 14,
              height: 14,
              padding: 0,
              background: 'none',
              border: 'none',
              color: 'var(--fg-3)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                transform: expanded ? 'rotate(90deg)' : 'none',
                display: 'inline-flex',
                transition: 'transform .1s',
              }}
            >
              {I.chevR}
            </span>
          </button>
        </div>
      </td>

      {/* Status dot column */}
      <td style={{ padding: '0 4px', verticalAlign: 'middle' }}>
        <StatusDot status={run.status} size={8} />
      </td>

      {/* Run name + id column */}
      <td style={{ padding: '0 10px', verticalAlign: 'middle' }} onClick={(e) => { e.stopPropagation(); onOpen(); }}>
        <div className="linkish" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isPinned && <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>{I.pin}</span>}
          <span style={{ color: 'var(--fg)', fontWeight: 500 }}>{run.name}</span>
          <span style={{ color: 'var(--fg-4)', fontSize: 10.5 }}>{run.id}</span>
        </div>
        {run.status === 'failed' && run.error && (
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--danger)',
              marginTop: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {run.error}
          </div>
        )}
      </td>

      {/* Tags column */}
      <td style={{ padding: '0 10px', verticalAlign: 'middle' }}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap', overflow: 'hidden' }}>
          {(run.tags || []).slice(0, 3).map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      </td>

      {/* Sparkline column */}
      {!hideSpark && (
        <td style={{ padding: '0 10px', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {lossSeries.length > 0 && <Sparkline values={lossSeries} width={90} height={20} />}
            {accSeries.length > 0 && <Sparkline values={accSeries} width={90} height={20} color="var(--info)" />}
          </div>
        </td>
      )}

      {/* val_acc column */}
      <td style={{ padding: '0 10px', verticalAlign: 'middle', textAlign: 'right', color: final != null ? 'var(--fg)' : 'var(--fg-4)' }}>
        {final != null ? (final * 100).toFixed(1) + '%' : '—'}
      </td>

      {/* val_loss column */}
      <td style={{ padding: '0 10px', verticalAlign: 'middle', textAlign: 'right', color: finalLoss != null ? 'var(--fg)' : 'var(--fg-4)' }}>
        {finalLoss != null ? fmtNum(finalLoss, 3) : '—'}
      </td>

      {/* duration column */}
      <td style={{ padding: '0 10px', verticalAlign: 'middle', textAlign: 'right', color: 'var(--fg-2)' }}>
        <div>{fmtDuration(run.duration_s)}</div>
        {run.status === 'running' && (run as any).progress != null && (
          <div style={{ height: 2, background: 'var(--surface-3)', marginTop: 3 }}>
            <div style={{ height: '100%', width: ((run as any).progress * 100) + '%', background: 'var(--info)' }} />
          </div>
        )}
      </td>

      {/* started_at column */}
      <td style={{ padding: '0 10px', verticalAlign: 'middle', textAlign: 'right', color: 'var(--fg-3)', fontSize: 11 }}>
        {relTime(run.started_at)}
      </td>

      {/* hover row actions */}
      <td style={{ padding: '0 10px', verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
        <div
          className="row-actions"
          style={{
            opacity: 0,
            transition: 'opacity .12s',
            display: 'flex',
            gap: 2,
            justifyContent: 'flex-end',
          }}
        >
          <IconBtn icon={I.pin} title="Pin (p)" onClick={onPin} active={isPinned} />
          <IconBtn icon={I.dot3} title="More" onClick={() => {}} />
        </div>
      </td>
    </tr>
  )
}

function RunRowExpanded({ run, cols }: { run: Run; cols: any[] }) {
  const shortCommit = run.commit ? run.commit.slice(0, 7) : ''
  const hardware = run.hardware as any

  return (
    <tr style={{ background: 'var(--surface-2)' }}>
      <td colSpan={cols.length} style={{ padding: '10px 18px 14px 50px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.8fr', gap: 24 }}>
          {/* Hyperparameters */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontFamily: 'var(--mono)' }}>
              hyperparameters
            </div>
            {Object.keys(run.hparams).length === 0 ? (
              <span style={{ color: 'var(--fg-4)', fontSize: 11, fontFamily: 'var(--mono)' }}>No hyperparameters.</span>
            ) : (
              <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                <tbody>
                  {Object.entries(run.hparams).slice(0, 8).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ color: 'var(--fg-4)', paddingRight: 12 }}>{k}</td>
                      <td style={{ color: 'var(--fg)' }}>{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Command Line & Git */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontFamily: 'var(--mono)' }}>
              command
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                color: 'var(--fg-2)',
                whiteSpace: 'pre-wrap',
                background: 'var(--bg)',
                padding: 8,
                borderRadius: 3,
                border: '1px solid var(--border)',
                fontFamily: 'var(--mono)',
              }}
            >
              <span style={{ color: 'var(--accent)' }}>$ </span>
              {run.cmd || 'python train.py'}
            </pre>
            <div style={{ marginTop: 8, display: 'flex', gap: 12, color: 'var(--fg-3)', fontSize: 11, fontFamily: 'var(--mono)' }}>
              {run.branch && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {I.branch} {run.branch}
                </span>
              )}
              {shortCommit && <span style={{ color: 'var(--accent)' }}>{shortCommit}</span>}
            </div>
          </div>

          {/* Hardware & Actions */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontFamily: 'var(--mono)' }}>
              hardware
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-2)', fontFamily: 'var(--mono)' }}>
              {hardware?.gpu ? (
                <div>
                  {hardware.gpu} <span style={{ color: 'var(--fg-4)' }}>× {hardware.count || 1}</span>
                </div>
              ) : (
                <div>—</div>
              )}
              {hardware?.cpu && <div style={{ color: 'var(--fg-3)', marginTop: 2 }}>{hardware.cpu}</div>}
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <Btn onClick={() => navigate(run.status === 'running' ? `/live/${run.id}` : `/runs/${run.id}`)}>
                Open run →
              </Btn>
              <Btn
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(run, null, 2))
                  alert('Copied run metadata JSON to clipboard')
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {I.copy} JSON
                </span>
              </Btn>
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ─── Live Rail ──────────────────────────────────────────────────────────────

function LiveRail({ liveRuns, onClose }: { liveRuns: Run[]; onClose: () => void }) {
  return (
    <aside
      style={{
        width: 260,
        flex: '0 0 260px',
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          fontSize: 10.5,
          color: 'var(--fg-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontFamily: 'var(--mono)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status="running" size={8} />
          live runs · {liveRuns.length}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 14, padding: 0 }}>
          ×
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {liveRuns.map((r) => (
          <LiveRailRunCard key={r.id} run={r} />
        ))}
        {liveRuns.length === 0 && (
          <div style={{ padding: 20, color: 'var(--fg-4)', fontSize: 11.5, fontFamily: 'var(--mono)' }}>
            No live runs.
          </div>
        )}
      </div>
    </aside>
  )
}

function LiveRailRunCard({ run }: { run: Run }) {
  const { data: metrics = [] } = useQuery({
    queryKey: ['metrics-live-card', run.id],
    queryFn: () => api.getMetrics(run.id),
    refetchInterval: 2000,
  })

  const { data: resources = [] } = useQuery({
    queryKey: ['resources-live-card', run.id],
    queryFn: () => api.getResources(run.id),
    refetchInterval: 2000,
  })

  const lossSeries = useMemo(() => {
    const out: number[] = []
    for (const r of metrics) {
      const v = r.values['loss'] ?? r.values['train_loss'] ?? r.values['val_loss']
      if (typeof v === 'number') out.push(v)
    }
    return out
  }, [metrics])

  const accSeries = useMemo(() => {
    const out: number[] = []
    for (const r of metrics) {
      const v = r.values['val_acc'] ?? r.values['accuracy'] ?? r.values['acc']
      if (typeof v === 'number') out.push(v)
    }
    return out
  }, [metrics])

  const lastLoss = lossSeries[lossSeries.length - 1]
  const lastAcc = accSeries[accSeries.length - 1]

  const lastResource = resources[resources.length - 1]
  const ramPct = lastResource?.ram_pct ?? 0
  const gpuPct = lastResource?.gpus?.[0]?.util ?? 0

  const progress = (run as any).progress ?? 0

  return (
    <div
      onClick={() => navigate(`/live/${run.id}`)}
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
      }}
      className="row-hover"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ color: 'var(--fg)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontFamily: 'var(--mono)', fontWeight: 500 }}>
          {run.name}
        </span>
        <span style={{ color: 'var(--fg-4)', fontSize: 10.5, fontFamily: 'var(--mono)' }}>
          {(run as any).eta ? `eta ${(run as any).eta}` : `pid ${run.pid}`}
        </span>
      </div>
      <div style={{ height: 3, background: 'var(--surface-3)', marginBottom: 8 }}>
        <div style={{ height: '100%', width: (progress * 100) + '%', background: 'var(--info)', transition: 'width .3s' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <MiniMetric label="val_loss" value={lastLoss} series={lossSeries} />
        <MiniMetric label="val_acc" value={lastAcc} series={accSeries} color="var(--info)" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
        <ResourceMini label="GPU" pct={gpuPct || 0} />
        <ResourceMini label="MEM" pct={ramPct || 0} />
      </div>
    </div>
  )
}

function MiniMetric({
  label,
  value,
  series,
  color,
}: {
  label: string
  value?: number
  series: number[]
  color?: string
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '5px 7px', fontFamily: 'var(--mono)' }}>
      <div style={{ fontSize: 9.5, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 1 }}>
        <span style={{ fontSize: 11.5, color: 'var(--fg)' }}>{value != null ? fmtNum(value, 3) : '—'}</span>
        {series.length > 0 && <Sparkline values={series.slice(-30)} width={50} height={14} color={color} />}
      </div>
    </div>
  )
}

function ResourceMini({ label, pct }: { label: string; pct: number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '4px 7px', fontFamily: 'var(--mono)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-4)' }}>
        <span>{label}</span>
        <span style={{ color: 'var(--fg-2)' }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 3, background: 'var(--surface-3)', marginTop: 3 }}>
        <div style={{ height: '100%', width: pct + '%', background: pct > 80 ? 'var(--success)' : 'var(--accent)' }} />
      </div>
    </div>
  )
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function Footer({
  projectStorage,
  projectPath,
  totalRuns,
  visibleRuns,
  density,
  setDensity,
}: {
  projectStorage: number
  projectPath: string
  totalRuns: number
  visibleRuns: number
  density: 'compact' | 'comfy'
  setDensity: (d: 'compact' | 'comfy') => void
}) {
  const formatBytes = (n: number) => {
    if (n == null) return '—'
    const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    let i = 0
    let v = n
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024
      i++
    }
    return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${u[i]}`
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '5px 14px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-2)',
        fontFamily: 'var(--mono)',
        fontSize: 10.5,
        color: 'var(--fg-3)',
        height: 26,
      }}
    >
      <span>
        {visibleRuns}/{totalRuns} runs
      </span>
      <span style={{ color: 'var(--fg-4)' }}>·</span>
      <span>{formatBytes(projectStorage)} on disk</span>
      <span style={{ color: 'var(--fg-4)' }}>·</span>
      <span style={{ color: 'var(--fg-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {projectPath}
      </span>
      <span style={{ flex: 1 }} />
      <button
        onClick={() => setDensity(density === 'compact' ? 'comfy' : 'compact')}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--fg-3)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 'inherit',
        }}
      >
        density: <span style={{ color: 'var(--fg-2)' }}>{density}</span>
      </button>
      <span style={{ color: 'var(--fg-4)' }}>·</span>
      <span>
        press <KBD>?</KBD> for shortcuts
      </span>
    </div>
  )
}

function FilterBtn({
  label,
  active,
  onClick,
  count,
  dot,
}: {
  label: string
  active: boolean
  onClick: () => void
  count: number
  dot?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        padding: '4px 8px',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-2)',
        border: '1px solid ' + (active ? 'var(--accent)' : 'transparent'),
        borderRadius: 3,
        fontFamily: 'inherit',
        fontSize: 11,
        cursor: 'pointer',
        marginBottom: 2,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, textAlign: 'left' }}>
        {dot && <StatusDot status={dot} size={6} />}
        {label}
      </span>
      <span style={{ color: 'var(--fg-4)' }}>{count}</span>
    </button>
  )
}
