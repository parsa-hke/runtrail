import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { navigate } from '../lib/router'
import { KBD, StatusDot } from './atoms'
import { I } from './icons'

interface PaletteItem {
  kind: string
  label: string
  hint?: string
  sub?: string
  status?: string
  action: () => void
}

const SHORTCUTS = [
  ["Navigation", [
    ["g h", "Go to run list"],
    ["g s", "Go to settings"],
    ["g l", "Go to live runs"],
    ["esc", "Back / close"],
    ["?", "Show this overlay"],
  ]],
  ["Run list", [
    ["j / k", "Move down / up"],
    ["x",     "Toggle row selection"],
    ["enter", "Open selected run"],
    ["c",     "Compare selected runs"],
    ["/",     "Focus search"],
    ["p",     "Pin run"],
    ["t",     "Add tag"],
  ]],
  ["Run detail", [
    ["1 – 6", "Switch tabs"],
    ["[ / ]", "Prev / next run"],
    ["e",     "Edit name"],
    ["n",     "Add note"],
  ]],
  ["Diff view", [
    ["s",   "Swap sides"],
    ["d",   "Show only differences"],
    ["g c", "Jump to code diff"],
  ]],
]

interface ShortcutsOverlayProps {
  onClose: () => void
}

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 720,
          background: "var(--surface)",
          border: "1px solid var(--border-2)",
          borderRadius: 6,
          boxShadow: "var(--shadow)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-2)",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--fg)",
            }}
          >
            Keyboard shortcuts
          </h2>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--fg-3)",
              cursor: "pointer",
              fontSize: 16,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {SHORTCUTS.map(([section, rows]) => (
            <div key={section as string}>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--fg-4)",
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  marginBottom: 8,
                }}
              >
                {section as string}
              </div>
              {(rows as Array<[string, string]>).map(([keys, desc]) => (
                <div
                  key={keys}
                  style={{
                    display: "flex",
                    padding: "4px 0",
                    fontSize: 12,
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: "var(--fg-2)", flex: 1, fontFamily: "var(--mono)" }}>{desc}</span>
                  <span style={{ display: "inline-flex", gap: 2 }}>
                    {keys.split(" ").map((k, i) => (
                      <KBD key={i}>{k}</KBD>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface CommandPaletteProps {
  onClose: () => void
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const [q, setQ] = useState("")
  const [idx, setIdx] = useState(0)

  // Fetch runs list for search
  const activeProjectId = localStorage.getItem('rt:active_project') || ''
  const { data: runs = [] } = useQuery({
    queryKey: ['runs', activeProjectId],
    queryFn: () => api.listRuns({ project: activeProjectId || undefined, limit: 100 }),
  })

  const items = useMemo(() => {
    const base: PaletteItem[] = [
      { kind: "nav", label: "Go to run list", hint: "gh", action: () => navigate("/") },
      { kind: "nav", label: "Go to settings", hint: "gs", action: () => navigate("/settings") },
      { kind: "nav", label: "Compare last two runs", hint: "diff", action: () => {
        if (runs.length >= 2) {
          navigate(`/diff?ids=${runs[0].id},${runs[1].id}`)
        } else {
          navigate('/diff')
        }
      } },
      {
        kind: "action",
        label: "Toggle theme",
        action: () => {
          const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"
          document.documentElement.setAttribute("data-theme", t)
          localStorage.setItem("rt:theme", t)
          // Dispatch event to sync theme states across app if necessary
          window.dispatchEvent(new Event("storage"))
        },
      },
      ...runs.map((r) => ({
        kind: "run",
        label: r.name,
        sub: r.id,
        status: r.status,
        action: () => navigate(r.status === "running" ? `/live/${r.id}` : `/runs/${r.id}`),
      })),
    ]

    if (!q) return base.slice(0, 12)
    const qq = q.toLowerCase()
    return base
      .filter((b) => b.label.toLowerCase().includes(qq) || (b.sub || "").toLowerCase().includes(qq))
      .slice(0, 12)
  }, [q, runs])

  useEffect(() => {
    setIdx(0)
  }, [q])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setIdx((i) => Math.min(items.length - 1, i + 1))
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setIdx((i) => Math.max(0, i - 1))
      }
      if (e.key === "Enter") {
        e.preventDefault()
        const it = items[idx]
        if (it) {
          it.action()
          onClose()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [items, idx, onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        zIndex: 200,
        display: "flex",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 580,
          height: "fit-content",
          background: "var(--surface)",
          border: "1px solid var(--border-2)",
          borderRadius: 6,
          boxShadow: "var(--shadow)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 14px",
            height: 44,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>{I.terminal}</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="jump to run, action, or path…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--fg)",
              fontFamily: "var(--mono)",
              fontSize: 14,
            }}
          />
          <KBD>esc</KBD>
        </div>
        <div style={{ maxHeight: 360, overflow: "auto" }}>
          {items.map((it, i) => (
            <div
              key={i}
              onClick={() => {
                it.action()
                onClose()
              }}
              onMouseEnter={() => setIdx(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 14px",
                background: i === idx ? "var(--accent-soft)" : "transparent",
                cursor: "pointer",
                borderLeft: i === idx ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              <span
                style={{
                  color: "var(--fg-4)",
                  fontSize: 10,
                  width: 50,
                  fontFamily: "var(--mono)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                {it.kind}
              </span>
              {it.status && <StatusDot status={it.status} />}
              <span
                style={{
                  color: i === idx ? "var(--accent)" : "var(--fg)",
                  flex: 1,
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {it.label}
              </span>
              {it.sub && (
                <span style={{ color: "var(--fg-4)", fontFamily: "var(--mono)", fontSize: 10.5, marginRight: 8 }}>
                  {it.sub}
                </span>
              )}
              {"hint" in it && it.hint && <KBD>{it.hint}</KBD>}
            </div>
          ))}
          {items.length === 0 && (
            <div
              style={{
                padding: 24,
                color: "var(--fg-4)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              nothing matches
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "6px 14px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-2)",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--fg-4)",
          }}
        >
          <span>
            <KBD>↑</KBD>
            <KBD>↓</KBD> navigate
          </span>
          <span>
            <KBD>↵</KBD> open
          </span>
          <span style={{ flex: 1 }} />
          <span>{items.length} results</span>
        </div>
      </div>
    </div>
  )
}
