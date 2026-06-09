import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRoute, navigate } from './lib/router'
import { api } from './api/client'
import RunListPage from './pages/RunList'
import RunDetailPage from './pages/RunDetail'
import LiveRunPage from './pages/LiveRun'
import DiffPage from './pages/Diff'
import SettingsPage from './pages/Settings'
import { ShortcutsOverlay, CommandPalette } from './components/overlays'
import { I } from './components/icons'
import { KBD, StatusDot } from './components/atoms'

export default function App() {
  const route = useRoute()
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('rt:theme') as 'dark' | 'light') || 'dark',
  )
  const [helpOpen, setHelpOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('rt:theme', theme)
  }, [theme])

  // Sync theme changes from outside (e.g. command palette)
  useEffect(() => {
    const handleStorage = () => {
      const t = (localStorage.getItem('rt:theme') as 'dark' | 'light') || 'dark'
      setTheme(t)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  const { segs, query } = route

  const activeProjectId = localStorage.getItem('rt:active_project') || ''
  const { data: runs = [] } = useQuery({
    queryKey: ['runs', activeProjectId],
    queryFn: () => api.listRuns({ project: activeProjectId || undefined, limit: 500 }),
    enabled: true,
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.listProjects(),
  })

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0]

  // Global keyboard shortcuts
  useEffect(() => {
    let gPending = false
    let timer: any

    function onKey(e: KeyboardEvent) {
      // Ignore shortcuts if in input fields
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'k' || e.key === 'K') {
          e.preventDefault()
          setPaletteOpen(true)
          return
        }
      }

      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }

      if (e.key === 'Escape') {
        setHelpOpen(false)
        setPaletteOpen(false)
        return
      }

      if (e.key === 'g') {
        gPending = true
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          gPending = false
        }, 1200)
        return
      }

      if (gPending) {
        gPending = false
        if (timer) clearTimeout(timer)
        if (e.key === 'h') {
          e.preventDefault()
          navigate('/')
        }
        if (e.key === 's') {
          e.preventDefault()
          navigate('/settings')
        }
        if (e.key === 'l') {
          e.preventDefault()
          const live = runs.find((r) => r.status === 'running')
          if (live) {
            navigate(`/live/${live.id}`)
          }
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer) clearTimeout(timer)
    }
  }, [runs])

  let content: React.ReactNode
  if (!segs.length) {
    content = <RunListPage />
  } else if (segs[0] === 'runs' && segs[1]) {
    content = <RunDetailPage runId={segs[1]} />
  } else if (segs[0] === 'live' && segs[1]) {
    content = <LiveRunPage runId={segs[1]} />
  } else if (segs[0] === 'diff') {
    const ids = (query.ids || '').split(',').filter(Boolean)
    content = <DiffPage ids={ids} />
  } else if (segs[0] === 'settings') {
    content = <SettingsPage />
  } else {
    content = (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
        404 · not found
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar
        activeProjectName={activeProject?.name || '...'}
        runs={runs}
        theme={theme}
        toggleTheme={toggleTheme}
        segs={segs}
        openHelp={() => setHelpOpen(true)}
        openPalette={() => setPaletteOpen(true)}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {content}
      </div>

      {helpOpen && <ShortcutsOverlay onClose={() => setHelpOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}

function TopBar({
  activeProjectName,
  runs,
  theme,
  toggleTheme,
  segs,
  openHelp,
  openPalette,
}: {
  activeProjectName: string
  runs: any[]
  theme: 'dark' | 'light'
  toggleTheme: () => void
  segs: string[]
  openHelp: () => void
  openPalette: () => void
}) {
  const liveRuns = runs.filter((r) => r.status === 'running').length

  return (
    <header
      style={{
        height: 44,
        flex: '0 0 44px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 14px',
        background: 'var(--bg-2)',
        borderBottom: '1px solid var(--border)',
        fontFamily: 'var(--mono)',
        fontSize: 12,
      }}
    >
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none',
          border: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          padding: '4px 6px',
          borderRadius: 3,
        }}
      >
        {I.brand}
        <span style={{ color: 'var(--fg)', fontWeight: 600, letterSpacing: 0.3 }}>runtrail</span>
        <span style={{ color: 'var(--fg-4)', fontSize: 10, marginLeft: 2 }}>v0.1.0-dev</span>
      </button>

      <span style={{ color: 'var(--fg-4)' }}>/</span>
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--fg-2)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 12,
          padding: 0,
        }}
      >
        {activeProjectName}
      </button>

      {segs[0] === 'runs' && segs[1] && <Crumb color="var(--accent)">{segs[1]}</Crumb>}
      {segs[0] === 'live' && segs[1] && (
        <>
          <span style={{ color: 'var(--fg-4)' }}>/</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--info)' }}>
            <StatusDot status="running" size={6} />
            live · {segs[1]}
          </span>
        </>
      )}
      {segs[0] === 'diff' && <Crumb color="var(--accent)">diff</Crumb>}
      {segs[0] === 'settings' && <Crumb color="var(--fg-2)">settings</Crumb>}

      <span style={{ flex: 1 }} />

      <button
        onClick={openPalette}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 26,
          padding: '0 8px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border-2)',
          borderRadius: 3,
          color: 'var(--fg-3)',
          cursor: 'pointer',
          fontFamily: 'var(--mono)',
          fontSize: 11.5,
          marginRight: 6,
        }}
      >
        <span style={{ color: 'var(--fg-4)', display: 'inline-flex' }}>{I.search}</span>
        <span>jump to…</span>
        <span style={{ width: 60 }} />
        <KBD>⌘K</KBD>
      </button>

      <NavBtn label="Runs" active={!segs.length} onClick={() => navigate('/')} kbd="gh" />
      {liveRuns > 0 && (
        <NavBtn
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <StatusDot status="running" size={6} />
              Live <span style={{ color: 'var(--fg-4)', marginLeft: 2 }}>{liveRuns}</span>
            </span>
          }
          active={segs[0] === 'live'}
          onClick={() => {
            const r = runs.find((x) => x.status === 'running')
            if (r) navigate(`/live/${r.id}`)
          }}
          kbd="gl"
        />
      )}
      <NavBtn label="Diff" active={segs[0] === 'diff'} onClick={() => navigate('/diff')} />
      <NavBtn label="Settings" active={segs[0] === 'settings'} onClick={() => navigate('/settings')} kbd="gs" icon={I.gear} />

      <span style={{ width: 1, height: 18, background: 'var(--border-2)', margin: '0 2px' }} />

      <button
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        onClick={toggleTheme}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--fg-3)',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 3,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {theme === 'dark' ? I.sun : I.moon}
      </button>

      <button
        title="Shortcuts (?)"
        onClick={openHelp}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--fg-3)',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 3,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {I.question}
      </button>
    </header>
  )
}

function Crumb({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <>
      <span style={{ color: 'var(--fg-4)' }}>/</span>
      <span style={{ color }}>{children}</span>
    </>
  )
}

function NavBtn({
  label,
  active,
  onClick,
  kbd,
  icon,
}: {
  label: React.ReactNode
  active: boolean
  onClick: () => void
  kbd?: string
  icon?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 10px',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-2)',
        border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
        borderRadius: 3,
        fontFamily: 'var(--mono)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--hover)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      {icon && <span style={{ display: 'inline-flex' }}>{icon}</span>}
      {label}
      {kbd && <KBD>{kbd}</KBD>}
    </button>
  )
}
