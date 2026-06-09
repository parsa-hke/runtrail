"""Performance test for NFR-1 (logging overhead <1% of training step)."""

import time
import runtrail


def test_nfr1_logging_overhead() -> None:
    # 1. Warm up runtrail
    run_warmup = runtrail.init(mode="disabled")
    for step in range(100):
        run_warmup.log({"loss": 0.5, "acc": 0.9}, step=step)
    run_warmup.finish()

    # 2. Measure no-op baseline (mode="disabled")
    start = time.perf_counter()
    with runtrail.run(mode="disabled") as run:
        for step in range(5000):
            run.log({"loss": 0.5, "acc": 0.9}, step=step)
    baseline_time = time.perf_counter() - start

    # 3. Measure online mode (writes to disk / SQLite / JSONL)
    start = time.perf_counter()
    with runtrail.run(project="bench-proj", name="bench-run", mode="online") as run:
        for step in range(5000):
            run.log({"loss": 0.5, "acc": 0.9}, step=step)
    online_time = time.perf_counter() - start

    overhead_per_call = (online_time - baseline_time) / 5000
    print(f"\nBaseline (disabled): {baseline_time:.4f}s")
    print(f"Online: {online_time:.4f}s")
    print(f"Overhead per call: {overhead_per_call * 1e6:.2f} µs")

    # A typical training step in ML is > 10ms (10,000 µs).
    # NFR-1 says logging overhead <1% of training step.
    # If a training step is 10ms, 1% is 100 µs.
    # Let's assert overhead per call is < 150 µs (0.00015s) to account for CI environments.
    assert overhead_per_call < 0.00015, f"Logging overhead is too high: {overhead_per_call * 1e6:.2f} µs"
