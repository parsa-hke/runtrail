import math
import sys
import runtrail

# Read learning rate from command line, default to 1e-3
lr = 1e-3
if len(sys.argv) > 1:
    try:
        lr = float(sys.argv[1])
    except ValueError:
        pass

name = f"exp-lr-{lr}"

# Use context manager for automatic lifecycle management (init -> run -> finish)
with runtrail.run(
    project="lr-sweep-demo",
    name=name,
    config={
        "lr": lr,
        "batch_size": 32,
        "optimizer": "adamw" if lr < 5e-3 else "sgd", # Simulate switching optimizer
        "epochs": 100
    },
    tags=["sweep", f"lr-{lr}"],
    notes=f"Simulated experiment checking learning rate {lr}",
) as run:
    print(f"Started run {run.id} with learning rate={lr}")
    for step in range(100):
        # A simple decay simulation: higher learning rate decays loss faster
        decay_rate = lr * 200
        loss = 1.5 * math.exp(-step * decay_rate) + 0.05
        val_acc = 1.0 - math.exp(-step * decay_rate)
        
        run.log({"loss": loss, "val_acc": val_acc}, step=step)
        
    print(f"Finished run {run.id}. Loss: {loss:.4f}, Val Acc: {val_acc:.4f}")
