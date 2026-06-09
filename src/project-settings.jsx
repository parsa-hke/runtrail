/* global React, window */
const { useState: useStatePS } = React;

function ProjectSettings({ project, navigateTo }) {
  const [openSections, setOpenSections] = useStatePS(new Set(["general", "display"]));
  const [theme, setTheme] = useStatePS(document.documentElement.getAttribute("data-theme") || "dark");
  const [density, setDensity] = useStatePS("compact");
  const [smoothing, setSmoothing] = useStatePS(0.6);
  const [sync, setSync] = useStatePS(false);
  const [name, setName] = useStatePS(project.name);

  const toggle = (k) => setOpenSections(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)" }}>
      <div style={{ padding: "16px 32px 8px", borderBottom: "1px solid var(--border)", background: "var(--bg-2)" }}>
        <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <span onClick={() => navigateTo("#/")} className="linkish" style={{ cursor: "pointer" }}>{project.name}</span>
          <span>›</span>
          <span style={{ color: "var(--fg-2)" }}>settings</span>
        </div>
        <h1 style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600, color: "var(--fg)" }}>Project settings</h1>
      </div>

      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "200px minmax(0, 760px)",
        gap: 32,
        padding: "24px 32px",
        margin: "0 auto",
        maxWidth: 1100,
        width: "100%",
      }}>
        {/* Side nav */}
        <nav style={{ position: "sticky", top: 24, alignSelf: "start" }}>
          {[
            ["general", "General"],
            ["display", "Display"],
            ["baselines", "Pinned baselines"],
            ["sync", "Sync"],
            ["cleanup", "Cleanup"],
            ["export", "Export / import"],
          ].map(([k, label]) => (
            <a key={k} href={`#${k}`}
              onClick={(e) => { e.preventDefault(); document.getElementById(k)?.scrollIntoView({ block: "start" }); openSections.has(k) || toggle(k); }}
              style={{
                display: "block",
                padding: "5px 10px",
                color: "var(--fg-3)",
                fontFamily: "var(--mono)", fontSize: 12,
                borderLeft: "2px solid transparent",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--fg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--fg-3)"; }}
            >{label}</a>
          ))}
        </nav>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Section id="general" title="General" open={openSections.has("general")} onToggle={() => toggle("general")}>
            <Field label="Project name">
              <input value={name} onChange={(e) => setName(e.target.value)}
                style={fieldInputStyle} />
            </Field>
            <Field label="Description">
              <textarea defaultValue={project.description} rows={2} style={{ ...fieldInputStyle, resize: "vertical", fontFamily: "var(--sans)" }} />
            </Field>
            <Field label="Default tags">
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {project.default_tags.map(t => <Tag key={t} removable>{t}</Tag>)}
                <button style={dashedBtnStyle}>+ add</button>
              </div>
            </Field>
            <Field label="Storage location" sub="read-only">
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={project.path} readOnly style={{ ...fieldInputStyle, color: "var(--fg-3)" }} />
                <Btn size="sm" icon={I.folder}>open</Btn>
              </div>
            </Field>
            <Field label="Disk usage" sub={fmtBytes(project.storage)}>
              <DiskBreakdown breakdown={project.storage_breakdown} />
            </Field>
          </Section>

          <Section id="display" title="Display" open={openSections.has("display")} onToggle={() => toggle("display")}>
            <Field label="Theme">
              <div style={{ display: "flex", gap: 6 }}>
                {[["dark", I.moon], ["light", I.sun], ["auto", null]].map(([t, ic]) => (
                  <button key={t}
                    onClick={() => { setTheme(t); document.documentElement.setAttribute("data-theme", t === "auto" ? "dark" : t); localStorage.setItem("rt:theme", t === "auto" ? "dark" : t); }}
                    style={{
                      ...segmentBtnStyle,
                      background: theme === t ? "var(--accent-soft)" : "var(--surface-2)",
                      color: theme === t ? "var(--accent)" : "var(--fg-2)",
                      borderColor: theme === t ? "var(--accent)" : "var(--border-2)",
                    }}
                  >
                    {ic && <span>{ic}</span>}
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Density">
              <div style={{ display: "flex", gap: 6 }}>
                {["compact", "comfortable"].map(d => (
                  <button key={d} onClick={() => setDensity(d)} style={{
                    ...segmentBtnStyle,
                    background: density === d ? "var(--accent-soft)" : "var(--surface-2)",
                    color: density === d ? "var(--accent)" : "var(--fg-2)",
                    borderColor: density === d ? "var(--accent)" : "var(--border-2)",
                  }}>{d}</button>
                ))}
              </div>
            </Field>
            <Field label="Default smoothing" sub="applies to all chart panels">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Slider value={smoothing} onChange={setSmoothing} min={0} max={0.95} step={0.01} width={220} />
                <span style={{ fontFamily: "var(--mono)", color: "var(--fg)" }}>{smoothing.toFixed(2)}</span>
              </div>
            </Field>
            <Field label="Default columns in run list">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {["status", "name", "started", "duration", "val_acc", "val_loss", "tags", "user", "branch", "commit"].map(c => (
                  <label key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-2)" }}>
                    <Checkbox checked={["status", "name", "started", "duration", "val_acc", "val_loss", "tags"].includes(c)} onChange={() => {}} />
                    {c}
                  </label>
                ))}
              </div>
            </Field>
          </Section>

          <Section id="baselines" title="Pinned baselines" open={openSections.has("baselines")} onToggle={() => toggle("baselines")}>
            <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginBottom: 10 }}>
              Pinned baselines appear in the sidebar and as the dashed reference line in chart overlays.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 12 }}>
              <tbody>
                {project.baselines.map(id => {
                  const r = window.RT_DATA.RUNS.find(x => x.id === id);
                  if (!r) return null;
                  return (
                    <tr key={id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 0", width: 18 }}><span style={{ color: "var(--accent)" }}>{I.pin}</span></td>
                      <td style={{ padding: "8px 4px", color: "var(--fg)" }}>{r.name}</td>
                      <td style={{ padding: "8px 4px", color: "var(--fg-4)", fontSize: 11 }}>{r.id}</td>
                      <td style={{ padding: "8px 4px", color: "var(--fg-2)", textAlign: "right" }}>val_acc {fmtPct(r.final.val_acc, 1)}</td>
                      <td style={{ padding: "8px 0", width: 40, textAlign: "right" }}><IconBtn icon={I.trash} title="Remove" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button style={{ ...dashedBtnStyle, marginTop: 10, width: "100%", padding: "8px" }}>+ pin a run as baseline</button>
          </Section>

          <Section id="sync" title="Sync" sub="phase 2" open={openSections.has("sync")} onToggle={() => toggle("sync")}>
            <Field label="Enable sync">
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <Toggle on={sync} onChange={setSync} />
                <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>off — runs stay local-only</span>
              </label>
            </Field>
            <Field label="Sync server URL">
              <input defaultValue="https://runtrail.lab.internal" style={{ ...fieldInputStyle, opacity: sync ? 1 : 0.5 }} disabled={!sync} />
            </Field>
            <Field label="Last sync">
              <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-3)" }}>
                {sync ? "2026-05-13 11:42:08 · 14 runs synced" : "never"}
              </div>
            </Field>
            <div style={{ marginTop: 8 }}>
              <Btn icon={I.bolt} disabled={!sync}>Sync now</Btn>
            </div>
          </Section>

          <Section id="cleanup" title="Cleanup" open={openSections.has("cleanup")} onToggle={() => toggle("cleanup")}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--fg-2)" }}>Delete</span>
              <Select value="failed runs" onChange={() => {}} options={["failed runs", "killed runs", "all runs"]} width={130} />
              <span style={{ fontSize: 12, color: "var(--fg-2)" }}>older than</span>
              <Select value="30 days" onChange={() => {}} options={["7 days", "14 days", "30 days", "90 days"]} width={100} />
              <Btn>Preview</Btn>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--fg-2)" }}>Delete artifacts larger than</span>
              <Select value="500 MiB" onChange={() => {}} options={["100 MiB", "500 MiB", "1 GiB", "5 GiB"]} width={100} />
              <span style={{ fontSize: 12, color: "var(--fg-2)" }}>from runs older than</span>
              <Select value="14 days" onChange={() => {}} options={["7 days", "14 days", "30 days"]} width={100} />
              <Btn>Preview</Btn>
            </div>
            <div style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 3,
              fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--fg-3)",
            }}>
              <div style={{ color: "var(--fg-2)" }}>dry-run preview · 3 runs · 2.4 GiB freed</div>
              <div style={{ marginTop: 6, paddingLeft: 4, color: "var(--fg-4)" }}>
                <div>• run-l1a2 · scratch-tiny-debug · killed · 12 MiB</div>
                <div>• run-f7c1 · resnet50-bf16-batch512 · failed · 8 MiB</div>
                <div>• run-g3b8 · resnet50-sgd-momentum-95 · killed · 2.38 GiB</div>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <Btn size="xs" kind="danger" icon={I.trash}>Delete 3 runs</Btn>
                <Btn size="xs" kind="ghost">Cancel</Btn>
              </div>
            </div>
          </Section>

          <Section id="export" title="Export / import" open={openSections.has("export")} onToggle={() => toggle("export")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <ActionCard
                title="Export project"
                desc="A portable .runtrail.zip archive containing all runs, artifacts, snapshots, and metadata."
                action="Export…"
                icon={I.download}
              />
              <ActionCard
                title="Import project"
                desc="Load a .runtrail.zip into a fresh project. Conflicting run ids will be re-hashed."
                action="Import…"
                icon={I.folder}
              />
              <ActionCard
                title="Bulk export selected"
                desc="Export only the runs currently selected in the list view, with optional artifact inclusion."
                action="Export selected (0)"
                icon={I.download}
                disabled
              />
              <ActionCard
                title="CLI cheatsheet"
                desc="trackr export · trackr import · trackr archive · trackr restore — full docs in /docs/cli.md"
                action="View docs →"
                icon={I.terminal}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, sub, open, onToggle, children }) {
  return (
    <section id={id} style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 4,
      overflow: "hidden",
    }}>
      <button onClick={onToggle} style={{
        width: "100%",
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 16px",
        background: "var(--surface-2)",
        border: "none",
        borderBottom: open ? "1px solid var(--border)" : "none",
        fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600,
        color: "var(--fg)",
        cursor: "pointer", textAlign: "left",
      }}>
        <span style={{ color: "var(--fg-3)", display: "inline-flex", transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}>{I.chevR}</span>
        <span style={{ flex: 1, textTransform: "uppercase", letterSpacing: 0.4 }}>{title}</span>
        {sub && <span style={{ fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6 }}>{sub}</span>}
      </button>
      {open && <div style={{ padding: 18 }}>{children}</div>}
    </section>
  );
}

function Field({ label, sub, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 16, marginBottom: 14, alignItems: "flex-start" }}>
      <div style={{ paddingTop: 6 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-2)" }}>{label}</div>
        {sub && <div style={{ fontSize: 10.5, color: "var(--fg-4)", marginTop: 2 }}>{sub}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

const fieldInputStyle = {
  width: "100%", padding: "6px 10px",
  background: "var(--surface-2)", color: "var(--fg)",
  border: "1px solid var(--border-2)", borderRadius: 3,
  fontFamily: "var(--mono)", fontSize: 12, outline: "none",
};
const segmentBtnStyle = {
  height: 28, padding: "0 12px",
  background: "var(--surface-2)", color: "var(--fg-2)",
  border: "1px solid var(--border-2)", borderRadius: 3,
  fontFamily: "var(--mono)", fontSize: 12, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
};
const dashedBtnStyle = {
  height: 22, padding: "0 8px",
  background: "transparent", color: "var(--fg-4)",
  border: "1px dashed var(--border-2)", borderRadius: 2,
  fontFamily: "var(--mono)", fontSize: 11, cursor: "pointer",
};

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 32, height: 18, padding: 1,
      background: on ? "var(--accent)" : "var(--surface-3)",
      border: `1px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
      borderRadius: 10,
      position: "relative", cursor: "pointer",
    }}>
      <span style={{
        position: "absolute", top: 1, left: on ? 15 : 1,
        width: 14, height: 14, borderRadius: 8,
        background: on ? "#0d0f12" : "var(--fg-3)",
        transition: "left .15s",
      }} />
    </button>
  );
}

function DiskBreakdown({ breakdown }) {
  const entries = Object.entries(breakdown);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const colors = ["var(--accent)", "var(--info)", "var(--purple)"];
  return (
    <div>
      <div style={{ height: 8, display: "flex", borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
        {entries.map(([k, v], i) => (
          <div key={k} style={{ width: (v / total * 100) + "%", background: colors[i % colors.length] }} title={`${k}: ${v.toFixed(1)} GiB`} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, fontFamily: "var(--mono)", fontSize: 11.5 }}>
        {entries.map(([k, v], i) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--fg-3)" }}>
            <span style={{ width: 8, height: 8, background: colors[i % colors.length], borderRadius: 1 }} />
            {k} <span style={{ color: "var(--fg)" }}>{v.toFixed(1)} GiB</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ActionCard({ title, desc, action, icon, disabled }) {
  return (
    <div style={{
      padding: 14,
      background: "var(--surface-2)",
      border: "1px solid var(--border)",
      borderRadius: 3,
      opacity: disabled ? 0.5 : 1,
    }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, color: "var(--fg)", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5, marginBottom: 10, fontFamily: "var(--sans)" }}>{desc}</div>
      <Btn size="sm" icon={icon} disabled={disabled}>{action}</Btn>
    </div>
  );
}

window.ProjectSettings = ProjectSettings;
