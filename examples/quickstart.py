"""runtrail quickstart — logs 50 scalars, saves one artifact, then exits.

Run from the repo root:
    cd sdk
    python ../examples/quickstart.py

After it finishes, check:
    ls -lh ~/.runtrail/projects/
    sqlite3 ~/.runtrail/runtrail.db "SELECT id, name, status, duration_s FROM runs"
"""

from __future__ import annotations

import math
import os
import tempfile

import runtrail

# ── Initialize ─────────────────────────────────────────────────────────────────
run = runtrail.init(
    project="quickstart",
    name="demo-run",
    config={
        "lr": 3e-4,
        "batch_size": 64,
        "hidden_dim": 256,
        "epochs": 50,
        "optimizer": "adamw",
    },
    tags=["demo", "quickstart"],
    notes="Auto-generated quickstart example.",
    # Disable slow captures so the demo finishes quickly.
    capture_source=False,
    resource_interval=0,
)

print(f"Started run: {run.id}  project: {run.project}")

# ── Training loop ──────────────────────────────────────────────────────────────
for step in range(50):
    noise = 0.05 * math.sin(step * 0.7)
    loss = 1.0 * math.exp(-step * 0.08) + noise + 0.05
    val_loss = 1.1 * math.exp(-step * 0.075) + noise * 0.5 + 0.06
    acc = 1.0 - math.exp(-step * 0.09) - abs(noise) * 0.2
    lr = 3e-4 * (0.95 ** (step // 10))

    run.log(
        {
            "loss": loss,
            "val_loss": val_loss,
            "accuracy": acc,
            "lr": lr,
        },
        step=step,
    )

    if step % 10 == 9:
        print(f"  step={step:2d}  loss={loss:.4f}  val_loss={val_loss:.4f}  acc={acc:.4f}")

# ── Emit a structured event ────────────────────────────────────────────────────
run.event("info", "Training loop complete")

# ── Log a dummy artifact ──────────────────────────────────────────────────────
with tempfile.NamedTemporaryFile(
    mode="w", suffix=".txt", delete=False, prefix="weights_"
) as f:
    f.write("epoch=50\nloss=0.052\n")
    artifact_path = f.name

sha = run.log_artifact(artifact_path, name="final_weights.txt", type="model")
print(f"Logged artifact sha256={sha[:12]}…")
os.unlink(artifact_path)

# ── Tags / notes ──────────────────────────────────────────────────────────────
run.add_tag("converged")
run.add_note("Loss plateaued after step 40.")

# ── Finish ─────────────────────────────────────────────────────────────────────
run.finish()
print(f"\nRun {run.id} finished.  Home: {run._home}")
print("Run:  sqlite3 ~/.runtrail/runtrail.db \"SELECT id,name,status,duration_s FROM runs\"")
