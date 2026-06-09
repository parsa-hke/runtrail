/* global React, window */
const { useState: useStateRL, useMemo: useMemoRL, useEffect: useEffectRL, useRef: useRefRL } = React;

function Sidebar({ collapsed, onToggle, project, runs, savedView, setSavedView }) {
  const tags = useMemoRL(() => {
    const map = new Map();
    runs.forEach(r => (r.tags || []).forEach(t => map.set(t, (map.get(t) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [runs]);

  const statusCounts = useMemoRL(() => {
    const c = { running: 0, done: 0, failed: 0, killed: 0 };
    runs.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [runs]);

  if (collapsed) return null;

  return (
    <aside style={{
      width: 230,
      borderRight: "1px solid var(--border)",
      background: "var(--bg-2)",
      display: "flex",
      flexDirection: "column",
      flex: "0 0 230px",
      overflow: "hidden",
    }}>
      <div style={{ padding: "12px 14px 4px", fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6 }}>Saved views</div>
      <div style={{ padding: "0 6px 8px" }}>
        {project.saved_views.map(v => (
          <SidebarItem
            key={v.id}
            active={savedView === v.id}
            onClick={() => setSavedView(savedView === v.id ? null : v.id)}
            count={v.count}
            label={v.name}
          />
        ))}
        <SidebarItem icon={I.plus} label="New view" muted />
      </div>

      <div style={{ padding: "6px 14px 4px", fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6 }}>Status</div>
      <div style={{ padding: "0 6px 8px" }}>
        {Object.entries(statusCounts).map(([k, v]) => (
          <SidebarItem
            key={k}
            label={k}
            count={v}
            dot={k}
          />
        ))}
      </div>

      <div style={{ padding: "6px 14px 4px", fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6 }}>Tags</div>
      <div style={{ padding: "0 6px 8px", flex: 1, overflow: "auto" }}>
        {tags.map(([t, n]) => (
          <SidebarItem key={t} label={`#${t}`} count={n} />
        ))}
      </div>

      <div style={{ padding: "6px 14px 4px", fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6 }}>Pinned baselines</div>
      <div style={{ padding: "0 6px 12px" }}>
        {project.baselines.map(id => {
          const r = runs.find(x => x.id === id);
          if (!r) return null;
          return (
            <div key={id}
              onClick={() => location.hash = `#/runs/${id}`}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 8px", borderRadius: 3, cursor: "pointer",
                fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--fg-2)",
              }}
              className="row-hover"
            >
              <span style={{ color: "var(--accent)" }}>{I.pin}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.name}</span>
              <span style={{ color: "var(--fg-4)", fontSize: 10 }}>{fmtPct(r.final.val_acc, 1)}</span>
            </div>
          );
        })}
      </div>

      <div style={{
        padding: "10px 14px", borderTop: "1px solid var(--border)",
        fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-3)",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ color: "var(--fg-4)" }}>{I.folder}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.path}</span>
      </div>
    </aside>
  );
}

function SidebarItem({ label, count, icon, dot, active, onClick, muted }) {
  return (
    <div
      onClick={onClick}
      className="row-hover"
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 8px", borderRadius: 3, cursor: onClick ? "pointer" : "default",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : muted ? "var(--fg-4)" : "var(--fg-2)",
        fontFamily: "var(--mono)", fontSize: 11.5,
      }}
    >
      {icon && <span style={{ color: "var(--fg-3)" }}>{icon}</span>}
      {dot && <StatusDot status={dot} />}
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {count != null && <span style={{ color: "var(--fg-4)", fontSize: 10 }}>{count}</span>}
    </div>
  );
}

// ─── Run List Main ──────────────────────────────────────────────────────────
function RunList({ project, runs, navigateTo }) {
  const [selected, setSelected] = useStateRL(new Set());
  const [search, setSearch] = useStateRL("");
  const [filters, setFilters] = useStateRL([
    // example structured filter
    { key: "status", op: "in", val: ["done", "running"], on: true },
  ]);
  const [collapsed, setCollapsed] = useStateRL(false);
  const [rightRail, setRightRail] = useStateRL(true);
  const [density, setDensity] = useStateRL("compact"); // compact | comfy
  const [activeIdx, setActiveIdx] = useStateRL(0);
  const [savedView, setSavedView] = useStateRL(null);
  const [hideSpark, setHideSpark] = useStateRL(false);
  const searchRef = useRefRL(null);

  const visibleRuns = useMemoRL(() => {
    let list = runs;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    for (const f of filters) {
      if (!f.on) continue;
      if (f.key === "status" && f.op === "in") {
        list = list.filter(r => f.val.includes(r.status));
      } else if (f.key === "loss" && f.op === "<") {
        list = list.filter(r => r.final?.val_loss != null && r.final.val_loss < f.val);
      } else if (f.key === "optimizer" && f.op === "=") {
        list = list.filter(r => r.hparams?.optimizer === f.val);
      }
    }
    return list;
  }, [runs, search, filters]);

  const liveRuns = useMemoRL(() => runs.filter(r => r.status === "running"), [runs]);

  // keyboard
  useEffectRL(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === "j") setActiveIdx(i => Math.min(visibleRuns.length - 1, i + 1));
      if (e.key === "k") setActiveIdx(i => Math.max(0, i - 1));
      if (e.key === "x") {
        const id = visibleRuns[activeIdx]?.id;
        if (!id) return;
        setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
      }
      if (e.key === "Enter") {
        const id = visibleRuns[activeIdx]?.id;
        if (id) navigateTo(`#/runs/${id}`);
      }
      if (e.key === "c" && selected.size >= 2) {
        navigateTo(`#/diff?ids=${[...selected].join(",")}`);
      }
      if (e.key === "p") {
        const r = visibleRuns[activeIdx];
        if (r) Toast.show(`pinned ${r.name}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleRuns, activeIdx, selected, navigateTo]);

  const allChecked = visibleRuns.length > 0 && visibleRuns.every(r => selected.has(r.id));
  const someChecked = !allChecked && visibleRuns.some(r => selected.has(r.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Sub-toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-2)",
      }}>
        <IconBtn icon={collapsed ? I.list : I.list} title="Toggle sidebar" onClick={() => setCollapsed(c => !c)} active={!collapsed} />
        <Select
          value={project.name}
          onChange={() => {}}
          icon={I.folder}
          options={[{ value: project.name, label: project.name }, "scratchpad", "diffusion-research"]}
          width={180}
        />
        <div style={{ width: 1, height: 18, background: "var(--border-2)" }} />
        <div style={{ flex: 1, maxWidth: 360 }}>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter runs by name, id, tag…"
            style={{
              width: "100%", height: 26, padding: "0 8px 0 28px",
              background: "var(--surface-2)", border: "1px solid var(--border-2)",
              borderRadius: 3, color: "var(--fg)", outline: "none",
              fontFamily: "var(--mono)", fontSize: 12,
              backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 16 16' fill='none'><circle cx='7' cy='7' r='4.5' stroke='%23777' stroke-width='1.3'/><path d='M10.5 10.5L14 14' stroke='%23777' stroke-width='1.3' stroke-linecap='round'/></svg>\")",
              backgroundRepeat: "no-repeat", backgroundPosition: "8px center",
            }}
          />
        </div>
        <Btn icon={I.filter} kbd="f">New filter</Btn>
        <Btn icon={I.compare} kind={selected.size >= 2 ? "primary" : "default"} disabled={selected.size < 2}
          onClick={() => navigateTo(`#/diff?ids=${[...selected].join(",")}`)}
          kbd="c">
          Compare ({selected.size})
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn icon={I.bars} active={!hideSpark} onClick={() => setHideSpark(s => !s)}>Spark</Btn>
        <Btn icon={I.gear} kind="ghost" onClick={() => navigateTo("#/settings")} />
      </div>

      {/* Active filter chips */}
      {filters.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}>
          <span style={{ fontSize: 11, color: "var(--fg-4)" }}>filter:</span>
          {filters.map((f, i) => (
            <FilterChip key={i} filter={f} onToggle={() => setFilters(fs => fs.map((x, j) => j === i ? { ...x, on: !x.on } : x))} onRemove={() => setFilters(fs => fs.filter((_, j) => j !== i))} />
          ))}
          <button
            onClick={() => setFilters(fs => [...fs, { key: "loss", op: "<", val: 0.9, on: true }])}
            style={{
              height: 22, padding: "0 8px",
              background: "transparent", color: "var(--fg-3)",
              border: "1px dashed var(--border-2)", borderRadius: 2,
              fontFamily: "var(--mono)", fontSize: 11, cursor: "pointer",
            }}
          >+ loss &lt; 0.9</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{visibleRuns.length}/{runs.length} runs</span>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar collapsed={collapsed} project={project} runs={runs} savedView={savedView} setSavedView={setSavedView} />

        {/* Table */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <RunTable
            runs={visibleRuns}
            selected={selected}
            setSelected={setSelected}
            allChecked={allChecked}
            someChecked={someChecked}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            density={density}
            hideSpark={hideSpark}
            navigateTo={navigateTo}
          />
        </div>

        {rightRail && <LiveRail liveRuns={liveRuns} navigateTo={navigateTo} onClose={() => setRightRail(false)} />}
        {!rightRail && (
          <button
            onClick={() => setRightRail(true)}
            style={{
              width: 26, borderLeft: "1px solid var(--border)", background: "var(--bg-2)",
              color: "var(--fg-3)", fontFamily: "var(--mono)", fontSize: 10,
              writingMode: "vertical-rl", padding: "12px 0", cursor: "pointer",
            }}
          >LIVE RUNS · {liveRuns.length}</button>
        )}
      </div>

      {/* Footer */}
      <Footer project={project} runs={runs} visible={visibleRuns.length} density={density} setDensity={setDensity} />
    </div>
  );
}

function FilterChip({ filter, onToggle, onRemove }) {
  const text = filter.key === "status"
    ? `status ∈ {${filter.val.join(", ")}}`
    : `${filter.key} ${filter.op} ${filter.val}`;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      height: 22, padding: "0 4px 0 8px",
      background: filter.on ? "var(--accent-soft)" : "var(--surface-3)",
      color: filter.on ? "var(--accent)" : "var(--fg-3)",
      border: `1px solid ${filter.on ? "var(--accent)" : "var(--border-2)"}`,
      borderRadius: 2,
      fontFamily: "var(--mono)", fontSize: 11,
      cursor: "pointer",
    }}>
      <span onClick={onToggle}>{text}</span>
      <button onClick={onRemove} style={{ background: "none", border: "none", color: "inherit", padding: "0 4px", cursor: "pointer" }}>×</button>
    </div>
  );
}

// ─── Run Table ──────────────────────────────────────────────────────────────
function RunTable({ runs, selected, setSelected, allChecked, someChecked, activeIdx, setActiveIdx, density, hideSpark, navigateTo }) {
  const [sort, setSort] = useStateRL({ col: "started", dir: "desc" });
  const [expanded, setExpanded] = useStateRL(new Set());

  const sorted = useMemoRL(() => {
    const list = [...runs];
    const cmp = (a, b) => {
      let av, bv;
      if (sort.col === "name") { av = a.name; bv = b.name; }
      else if (sort.col === "started") { av = a.started; bv = b.started; }
      else if (sort.col === "duration") { av = a.duration; bv = b.duration; }
      else if (sort.col === "val_acc") { av = a.final?.val_acc ?? -1; bv = b.final?.val_acc ?? -1; }
      else if (sort.col === "val_loss") { av = a.final?.val_loss ?? Infinity; bv = b.final?.val_loss ?? Infinity; }
      else { av = a[sort.col]; bv = b[sort.col]; }
      return av > bv ? 1 : av < bv ? -1 : 0;
    };
    list.sort((a, b) => sort.dir === "asc" ? cmp(a, b) : -cmp(a, b));
    return list;
  }, [runs, sort]);

  const toggleSort = (col) => setSort(s => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" });

  const rowH = density === "compact" ? 30 : 38;

  const cols = [
    { key: "check", w: 28 },
    { key: "status", label: "", w: 14 },
    { key: "name", label: "run", flex: 1 },
    { key: "tags", label: "tags", w: 180 },
    { key: "spark", label: "val_loss · val_acc", w: hideSpark ? 0 : 200 },
    { key: "val_acc", label: "val_acc", w: 80, num: true },
    { key: "val_loss", label: "val_loss", w: 80, num: true },
    { key: "duration", label: "duration", w: 80, num: true },
    { key: "started", label: "started", w: 110, num: true },
    { key: "actions", w: 80 },
  ].filter(c => c.w !== 0);

  return (
    <div style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
      <table style={{
        width: "100%", borderCollapse: "separate", borderSpacing: 0,
        fontFamily: "var(--mono)", fontSize: 12,
      }}>
        <thead>
          <tr style={{
            background: "var(--bg-2)",
            position: "sticky", top: 0, zIndex: 1,
          }}>
            {cols.map((c, i) => (
              <th key={c.key} style={{
                position: "sticky", top: 0,
                textAlign: c.num ? "right" : "left",
                padding: c.key === "check" ? "0 6px 0 14px" : "0 10px",
                height: 28,
                fontWeight: 500, fontSize: 10.5,
                color: "var(--fg-3)",
                textTransform: "uppercase", letterSpacing: 0.6,
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-2)",
                width: c.w, minWidth: c.w,
                cursor: ["name", "duration", "started", "val_acc", "val_loss"].includes(c.key) ? "pointer" : "default",
                userSelect: "none",
              }}
                onClick={() => ["name", "duration", "started", "val_acc", "val_loss"].includes(c.key) && toggleSort(c.key)}
              >
                {c.key === "check" ? (
                  <Checkbox
                    checked={allChecked}
                    indeterminate={someChecked}
                    onChange={(v) => setSelected(v ? new Set(runs.map(r => r.id)) : new Set())}
                  />
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {c.label}
                    {sort.col === c.key && (
                      <span style={{ color: "var(--accent)" }}>{sort.dir === "asc" ? "↑" : "↓"}</span>
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
                idx={idx}
                isActive={idx === activeIdx}
                isSelected={selected.has(r.id)}
                onSelect={() => setSelected(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}
                onFocus={() => setActiveIdx(idx)}
                onOpen={() => navigateTo(r.status === "running" ? `#/live/${r.id}` : `#/runs/${r.id}`)}
                onToggleExpand={() => setExpanded(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}
                expanded={expanded.has(r.id)}
                hideSpark={hideSpark}
                rowH={rowH}
                cols={cols}
              />
            ];
            if (expanded.has(r.id)) {
              items.push(<RunRowExpanded key={r.id + "-x"} run={r} cols={cols} navigateTo={navigateTo} />);
            }
            return items;
          })}
        </tbody>
      </table>
      {runs.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)", fontSize: 12 }}>
          No runs match. Try clearing filters.
        </div>
      )}
    </div>
  );
}

function RunRow({ run, idx, isActive, isSelected, onSelect, onFocus, onOpen, onToggleExpand, expanded, hideSpark, rowH, cols }) {
  const r = run;
  const sc = STATUS_COLOR[r.status];
  return (
    <tr
      className="row-hover"
      onClick={onFocus}
      onDoubleClick={onOpen}
      style={{
        height: rowH,
        background: isActive ? "var(--surface-2)" : "transparent",
        borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <td style={{ padding: "0 6px 0 14px", verticalAlign: "middle" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Checkbox checked={isSelected} onChange={onSelect} />
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            style={{ width: 14, height: 14, padding: 0, background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <span style={{ transform: expanded ? "rotate(90deg)" : "none", display: "inline-flex", transition: "transform .1s" }}>{I.chevR}</span>
          </button>
        </div>
      </td>
      <td style={{ padding: "0 4px", verticalAlign: "middle" }}>
        <StatusDot status={r.status} pulse={r.status === "running"} />
      </td>
      <td style={{ padding: "0 10px", verticalAlign: "middle" }} onClick={(e) => { if (e.detail === 1) onOpen(); }}>
        <div className="linkish" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {r.pinned && <span style={{ color: "var(--accent)" }}>{I.pin}</span>}
          <span style={{ color: "var(--fg)" }}>{r.name}</span>
          <span style={{ color: "var(--fg-4)", fontSize: 10.5 }}>{r.id}</span>
        </div>
        {r.status === "failed" && r.error && (
          <div style={{ fontSize: 10.5, color: "var(--danger)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.error}</div>
        )}
      </td>
      <td style={{ padding: "0 10px", verticalAlign: "middle" }}>
        <div style={{ display: "flex", gap: 3, flexWrap: "nowrap", overflow: "hidden" }}>
          {(r.tags || []).slice(0, 3).map(t => <Tag key={t}>{t}</Tag>)}
        </div>
      </td>
      {!hideSpark && (
        <td style={{ padding: "0 10px", verticalAlign: "middle" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {r.metrics?.val_loss && (
              <Sparkline series={r.metrics.val_loss.series} width={90} height={20} />
            )}
            {r.metrics?.val_acc && (
              <Sparkline series={r.metrics.val_acc.series} width={90} height={20} color="var(--info)" />
            )}
          </div>
        </td>
      )}
      <td style={{ padding: "0 10px", verticalAlign: "middle", textAlign: "right", color: r.final?.val_acc ? "var(--fg)" : "var(--fg-4)" }}>
        {r.final?.val_acc != null ? fmtPct(r.final.val_acc, 1) : "—"}
      </td>
      <td style={{ padding: "0 10px", verticalAlign: "middle", textAlign: "right", color: r.final?.val_loss ? "var(--fg)" : "var(--fg-4)" }}>
        {r.final?.val_loss != null ? fmtNum(r.final.val_loss, 3) : "—"}
      </td>
      <td style={{ padding: "0 10px", verticalAlign: "middle", textAlign: "right", color: "var(--fg-2)" }}>
        {fmtDuration(r.duration)}
        {r.status === "running" && r.progress && (
          <div style={{ height: 2, background: "var(--surface-3)", marginTop: 3 }}>
            <div style={{ height: "100%", width: (r.progress * 100) + "%", background: "var(--info)" }} />
          </div>
        )}
      </td>
      <td style={{ padding: "0 10px", verticalAlign: "middle", textAlign: "right", color: "var(--fg-3)", fontSize: 11 }}>
        {relTime(r.started)}
      </td>
      <td style={{ padding: "0 10px", verticalAlign: "middle" }}>
        <div className="row-actions" style={{ opacity: 0, transition: "opacity .12s", display: "flex", gap: 2, justifyContent: "flex-end" }}>
          <IconBtn icon={I.pin} title="Pin (p)" onClick={(e) => { e.stopPropagation(); Toast.show(`pinned ${r.name}`); }} />
          <IconBtn icon={I.tag} title="Tag (t)" onClick={(e) => { e.stopPropagation(); Toast.show("tag dialog"); }} />
          <IconBtn icon={I.dot3} title="More" onClick={(e) => e.stopPropagation()} />
        </div>
      </td>
    </tr>
  );
}

function RunRowExpanded({ run, cols, navigateTo }) {
  const r = run;
  return (
    <tr style={{ background: "var(--surface-2)" }}>
      <td colSpan={cols.length} style={{ padding: "10px 18px 14px 50px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.8fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>hyperparameters</div>
            <table style={{ borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 11.5 }}>
              <tbody>
                {Object.entries(r.hparams || {}).slice(0, 6).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: "var(--fg-4)", paddingRight: 12 }}>{k}</td>
                    <td style={{ color: "var(--fg)" }}>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>command</div>
            <pre style={{ margin: 0, fontSize: 11, color: "var(--fg-2)", whiteSpace: "pre-wrap", background: "var(--bg)", padding: 8, borderRadius: 3, border: "1px solid var(--border)" }}>
              <span style={{ color: "var(--accent)" }}>$ </span>{r.cmd || "python train.py …"}
            </pre>
            <div style={{ marginTop: 8, display: "flex", gap: 6, color: "var(--fg-3)", fontSize: 11 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{I.branch} {r.branch}</span>
              <span style={{ color: "var(--accent)" }}>{r.commit}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>hardware</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-2)" }}>
              <div>{r.hardware?.gpu || "—"} <span style={{ color: "var(--fg-4)" }}>× {r.hardware?.count}</span></div>
              <div style={{ color: "var(--fg-3)" }}>{r.hardware?.cpu || "—"}</div>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <Btn size="xs" onClick={() => navigateTo(r.status === "running" ? `#/live/${r.id}` : `#/runs/${r.id}`)}>Open run →</Btn>
              <Btn size="xs" kind="ghost" icon={I.copy} onClick={() => Toast.show("copied json")}>JSON</Btn>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Live Rail ──────────────────────────────────────────────────────────────
function LiveRail({ liveRuns, navigateTo, onClose }) {
  return (
    <aside style={{
      width: 260, flex: "0 0 260px",
      borderLeft: "1px solid var(--border)",
      background: "var(--bg-2)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.6,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <StatusDot status="running" pulse />
          live runs · {liveRuns.length}
        </span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {liveRuns.map(r => (
          <div key={r.id}
            onClick={() => navigateTo(`#/live/${r.id}`)}
            style={{
              padding: "10px 12px", borderBottom: "1px solid var(--border)",
              cursor: "pointer",
            }}
            className="row-hover"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ color: "var(--fg)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {r.name}
              </span>
              <span style={{ color: "var(--fg-4)", fontSize: 10.5 }}>eta {r.eta}</span>
            </div>
            <div style={{ height: 3, background: "var(--surface-3)", marginBottom: 8 }}>
              <div style={{ height: "100%", width: (r.progress * 100) + "%", background: "var(--info)", transition: "width .3s" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <MiniMetric label="val_loss" value={r.metrics.val_loss?.last} series={r.metrics.val_loss?.series} />
              <MiniMetric label="val_acc" value={r.metrics.val_acc?.last && fmtPct(r.metrics.val_acc.last, 1)} series={r.metrics.val_acc?.series} color="var(--info)" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
              <ResourceMini label="GPU" pct={94} />
              <ResourceMini label="MEM" pct={81} />
            </div>
          </div>
        ))}
        {liveRuns.length === 0 && (
          <div style={{ padding: 20, color: "var(--fg-4)", fontSize: 11.5 }}>No live runs.</div>
        )}
      </div>
    </aside>
  );
}

function MiniMetric({ label, value, series, color }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 3, padding: "5px 7px" }}>
      <div style={{ fontSize: 9.5, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 1 }}>
        <span style={{ fontSize: 11.5, color: "var(--fg)" }}>{value != null ? (typeof value === "number" ? fmtNum(value, 3) : value) : "—"}</span>
        {series && <Sparkline series={series.slice(-30)} width={50} height={14} color={color} />}
      </div>
    </div>
  );
}

function ResourceMini({ label, pct }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 3, padding: "4px 7px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--fg-4)" }}>
        <span>{label}</span>
        <span style={{ color: "var(--fg-2)" }}>{pct}%</span>
      </div>
      <div style={{ height: 3, background: "var(--surface-3)", marginTop: 3 }}>
        <div style={{ height: "100%", width: pct + "%", background: pct > 80 ? "var(--success)" : "var(--accent)" }} />
      </div>
    </div>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────
function Footer({ project, runs, visible, density, setDensity }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "5px 14px",
      borderTop: "1px solid var(--border)",
      background: "var(--bg-2)",
      fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-3)",
      height: 26,
    }}>
      <span>{visible}/{runs.length} runs</span>
      <span style={{ color: "var(--fg-4)" }}>·</span>
      <span>{fmtBytes(project.storage)} on disk</span>
      <span style={{ color: "var(--fg-4)" }}>·</span>
      <span style={{ color: "var(--fg-4)" }}>{project.path}</span>
      <span style={{ flex: 1 }} />
      <button onClick={() => setDensity(density === "compact" ? "comfy" : "compact")} style={{ background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>
        density: <span style={{ color: "var(--fg-2)" }}>{density}</span>
      </button>
      <span style={{ color: "var(--fg-4)" }}>·</span>
      <span>press <KBD>?</KBD> for shortcuts</span>
    </div>
  );
}

window.RunList = RunList;
