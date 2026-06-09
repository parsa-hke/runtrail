/* global React, ReactDOM, window */
const { useState: useStateApp, useEffect: useEffectApp, useMemo: useMemoApp, useRef: useRefApp } = React;

function parseHash(h) {
  // #/runs/abc
  // #/diff?ids=a,b
  // #/settings
  // #/live/abc
  // #/
  const raw = (h || "").replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  const segs = path.split("/").filter(Boolean);
  const query = {};
  (qs || "").split("&").filter(Boolean).forEach(p => {
    const [k, v] = p.split("=");
    query[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  return { segs, query };
}

function App() {
  const [hash, setHash] = useStateApp(window.location.hash || "#/");
  const [theme, setTheme] = useStateApp(localStorage.getItem("rt:theme") || "dark");
  const [helpOpen, setHelpOpen] = useStateApp(false);
  const [paletteOpen, setPaletteOpen] = useStateApp(false);

  useEffectApp(() => {
    function onHash() { setHash(window.location.hash || "#/"); }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // global keyboard
  useEffectApp(() => {
    let gPending = false;
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "k") { e.preventDefault(); setPaletteOpen(true); return; }
      }
      if (e.key === "?") { setHelpOpen(true); return; }
      if (e.key === "Escape") { setHelpOpen(false); setPaletteOpen(false); return; }
      if (e.key === "g") { gPending = true; setTimeout(() => { gPending = false; }, 1200); return; }
      if (gPending) {
        gPending = false;
        if (e.key === "h") navigateTo("#/");
        if (e.key === "s") navigateTo("#/settings");
        if (e.key === "l") {
          const live = window.RT_DATA.RUNS.find(r => r.status === "running");
          if (live) navigateTo(`#/live/${live.id}`);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigateTo = (h) => { window.location.hash = h; };

  const setThemeAndPersist = (t) => {
    setTheme(t);
    localStorage.setItem("rt:theme", t);
    document.documentElement.setAttribute("data-theme", t);
  };

  const { segs, query } = parseHash(hash);
  const project = window.RT_DATA.PROJECT;
  const runs = window.RT_DATA.RUNS;

  let page;
  let pageKey = segs[0] || "home";
  if (!segs.length) {
    page = <RunList project={project} runs={runs} navigateTo={navigateTo} />;
  } else if (segs[0] === "runs" && segs[1]) {
    const r = runs.find(x => x.id === segs[1]);
    page = r ? <RunDetail run={r} runs={runs} project={project} navigateTo={navigateTo} /> : <NotFound back={() => navigateTo("#/")} />;
  } else if (segs[0] === "live" && segs[1]) {
    const r = runs.find(x => x.id === segs[1]);
    page = r ? <LiveRunView run={r} runs={runs} project={project} navigateTo={navigateTo} /> : <NotFound back={() => navigateTo("#/")} />;
  } else if (segs[0] === "diff") {
    const ids = (query.ids || "").split(",").filter(Boolean);
    page = <DiffViewPage runs={runs} ids={ids.length ? ids : ["run-a1f3", "run-b8e2"]} project={project} navigateTo={navigateTo} />;
  } else if (segs[0] === "settings") {
    page = <ProjectSettings project={project} navigateTo={navigateTo} />;
  } else {
    page = <NotFound back={() => navigateTo("#/")} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <style>{GLOBAL_CSS}</style>
      <TopBar
        project={project}
        runs={runs}
        currentPath={segs}
        theme={theme}
        setTheme={setThemeAndPersist}
        navigateTo={navigateTo}
        openHelp={() => setHelpOpen(true)}
        openPalette={() => setPaletteOpen(true)}
      />
      <div key={pageKey + (segs[1] || "")} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {page}
      </div>
      <Toaster />
      {helpOpen && <ShortcutsOverlay onClose={() => setHelpOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} runs={runs} navigateTo={navigateTo} />}
    </div>
  );
}

function TopBar({ project, runs, currentPath, theme, setTheme, navigateTo, openHelp, openPalette }) {
  const liveRuns = runs.filter(r => r.status === "running").length;
  return (
    <header style={{
      height: 44,
      flex: "0 0 44px",
      display: "flex", alignItems: "center", gap: 10,
      padding: "0 14px",
      background: "var(--bg-2)",
      borderBottom: "1px solid var(--border)",
      fontFamily: "var(--mono)", fontSize: 12,
    }}>
      <div onClick={() => navigateTo("#/")} style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        cursor: "pointer", padding: "4px 6px", borderRadius: 3,
      }}>
        {I.brand}
        <span style={{ color: "var(--fg)", fontWeight: 600, letterSpacing: 0.3 }}>runtrail</span>
        <span style={{ color: "var(--fg-4)", fontSize: 10, marginLeft: 2 }}>v0.4.2</span>
      </div>
      <span style={{ color: "var(--fg-4)" }}>/</span>
      <button onClick={() => navigateTo("#/")} style={{ background: "none", border: "none", color: "var(--fg-2)", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
        {project.name}
      </button>

      {currentPath[0] === "runs" && currentPath[1] && (
        <>
          <span style={{ color: "var(--fg-4)" }}>/</span>
          <span style={{ color: "var(--accent)" }}>{currentPath[1]}</span>
        </>
      )}
      {currentPath[0] === "diff" && (
        <>
          <span style={{ color: "var(--fg-4)" }}>/</span>
          <span style={{ color: "var(--accent)" }}>diff</span>
        </>
      )}
      {currentPath[0] === "live" && (
        <>
          <span style={{ color: "var(--fg-4)" }}>/</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--info)" }}>
            <StatusDot status="running" pulse />
            live · {currentPath[1]}
          </span>
        </>
      )}
      {currentPath[0] === "settings" && (
        <>
          <span style={{ color: "var(--fg-4)" }}>/</span>
          <span style={{ color: "var(--fg-2)" }}>settings</span>
        </>
      )}

      <span style={{ flex: 1 }} />

      <button onClick={openPalette} style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        height: 26, padding: "0 8px",
        background: "var(--surface-2)", border: "1px solid var(--border-2)",
        borderRadius: 3, color: "var(--fg-3)", cursor: "pointer",
        fontFamily: "var(--mono)", fontSize: 11.5,
      }}>
        <span style={{ color: "var(--fg-4)" }}>{I.search}</span>
        <span>jump to…</span>
        <span style={{ flex: 1, width: 80 }} />
        <KBD>⌘K</KBD>
      </button>

      <NavBtn label="Runs" active={currentPath.length === 0} onClick={() => navigateTo("#/")} kbd="gh" />
      {liveRuns > 0 && (
        <NavBtn label={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <StatusDot status="running" pulse />
            Live <span style={{ color: "var(--fg-4)", marginLeft: 2 }}>{liveRuns}</span>
          </span>
        }
          active={currentPath[0] === "live"}
          onClick={() => {
            const r = window.RT_DATA.RUNS.find(x => x.status === "running");
            if (r) navigateTo(`#/live/${r.id}`);
          }}
          kbd="gl"
        />
      )}
      <NavBtn label="Diff" active={currentPath[0] === "diff"} onClick={() => navigateTo("#/diff?ids=run-a1f3,run-b8e2")} />
      <NavBtn label="Settings" active={currentPath[0] === "settings"} onClick={() => navigateTo("#/settings")} kbd="gs" icon={I.gear} />

      <span style={{ width: 1, height: 18, background: "var(--border-2)", margin: "0 2px" }} />

      <IconBtn
        icon={theme === "dark" ? I.sun : I.moon}
        title={`Switch to ${theme === "dark" ? "light" : "dark"}`}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      />
      <IconBtn icon={I.question} title="Shortcuts (?)" onClick={openHelp} />
    </header>
  );
}

function NavBtn({ label, active, onClick, kbd, icon }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      height: 26, padding: "0 10px",
      background: active ? "var(--accent-soft)" : "transparent",
      color: active ? "var(--accent)" : "var(--fg-2)",
      border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
      borderRadius: 3,
      fontFamily: "var(--mono)", fontSize: 12, fontWeight: 500,
      cursor: "pointer",
    }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--hover)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      {icon}
      {label}
      {kbd && <KBD>{kbd}</KBD>}
    </button>
  );
}

// ─── Shortcuts overlay ──────────────────────────────────────────────────────
function ShortcutsOverlay({ onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      backdropFilter: "blur(4px)",
      zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 40,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 720,
        background: "var(--surface)",
        border: "1px solid var(--border-2)",
        borderRadius: 6,
        boxShadow: "var(--shadow)",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", padding: "12px 18px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)",
        }}>
          <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>Keyboard shortcuts</h2>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {window.RT_DATA.SHORTCUTS.map(([section, rows]) => (
            <div key={section}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>{section}</div>
              {rows.map(([keys, desc]) => (
                <div key={keys} style={{ display: "flex", padding: "4px 0", fontSize: 12, alignItems: "center" }}>
                  <span style={{ color: "var(--fg-2)", flex: 1 }}>{desc}</span>
                  <span style={{ display: "inline-flex", gap: 2 }}>
                    {keys.split(" ").map((k, i) => <KBD key={i}>{k}</KBD>)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Command palette (cmd-k) ────────────────────────────────────────────────
function CommandPalette({ onClose, runs, navigateTo }) {
  const [q, setQ] = useStateApp("");
  const [idx, setIdx] = useStateApp(0);

  const items = useMemoApp(() => {
    const base = [
      { kind: "nav", label: "Go to run list", hint: "gh", action: () => navigateTo("#/") },
      { kind: "nav", label: "Go to settings", hint: "gs", action: () => navigateTo("#/settings") },
      { kind: "nav", label: "Compare last two runs", hint: "diff", action: () => navigateTo(`#/diff?ids=${runs[0].id},${runs[1].id}`) },
      { kind: "action", label: "New filter", action: () => Toast.show("filter dialog") },
      { kind: "action", label: "Toggle theme", action: () => {
        const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", t);
        localStorage.setItem("rt:theme", t);
      } },
      ...runs.map(r => ({
        kind: "run", label: r.name, sub: r.id, status: r.status,
        action: () => navigateTo(r.status === "running" ? `#/live/${r.id}` : `#/runs/${r.id}`),
      })),
    ];
    if (!q) return base.slice(0, 12);
    const qq = q.toLowerCase();
    return base.filter(b => b.label.toLowerCase().includes(qq) || (b.sub || "").toLowerCase().includes(qq)).slice(0, 12);
  }, [q, runs]);

  useEffectApp(() => { setIdx(0); }, [q]);

  useEffectApp(() => {
    function onKey(e) {
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const it = items[idx];
        if (it) { it.action(); onClose(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, idx]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      backdropFilter: "blur(4px)",
      zIndex: 200, display: "flex", justifyContent: "center", paddingTop: "12vh",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 580, height: "fit-content",
        background: "var(--surface)",
        border: "1px solid var(--border-2)",
        borderRadius: 6,
        boxShadow: "var(--shadow)",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 14px", height: 44,
          borderBottom: "1px solid var(--border)",
        }}>
          <span style={{ color: "var(--accent)" }}>{I.terminal}</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="jump to run, action, or path…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--fg)", fontFamily: "var(--mono)", fontSize: 14,
            }}
          />
          <KBD>esc</KBD>
        </div>
        <div style={{ maxHeight: 360, overflow: "auto" }}>
          {items.map((it, i) => (
            <div
              key={i}
              onClick={() => { it.action(); onClose(); }}
              onMouseEnter={() => setIdx(i)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 14px",
                background: i === idx ? "var(--accent-soft)" : "transparent",
                cursor: "pointer",
                borderLeft: i === idx ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              <span style={{ color: "var(--fg-4)", fontSize: 10, width: 40, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: 0.6 }}>{it.kind}</span>
              {it.status && <StatusDot status={it.status} />}
              <span style={{ color: i === idx ? "var(--accent)" : "var(--fg)", flex: 1, fontFamily: "var(--mono)", fontSize: 12.5 }}>{it.label}</span>
              {it.sub && <span style={{ color: "var(--fg-4)", fontFamily: "var(--mono)", fontSize: 10.5 }}>{it.sub}</span>}
              {it.hint && <KBD>{it.hint}</KBD>}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ padding: 24, color: "var(--fg-4)", fontFamily: "var(--mono)", fontSize: 12, textAlign: "center" }}>nothing matches</div>
          )}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "6px 14px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-2)",
          fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-4)",
        }}>
          <span><KBD>↑</KBD><KBD>↓</KBD> navigate</span>
          <span><KBD>↵</KBD> open</span>
          <span style={{ flex: 1 }} />
          <span>{items.length} results</span>
        </div>
      </div>
    </div>
  );
}

function NotFound({ back }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-3)", flexDirection: "column", gap: 12 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>404 · not found in this project</span>
      <Btn onClick={back}>← back to runs</Btn>
    </div>
  );
}

// ─── Boot ───────────────────────────────────────────────────────────────────
document.getElementById("boot").classList.add("ready");
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
