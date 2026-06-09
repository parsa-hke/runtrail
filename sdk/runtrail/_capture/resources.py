"""Background resource sampler.

Samples CPU, RAM, and GPU utilisation at a configurable interval and
pushes LogResource messages onto the WriteQueue.

Usage:
    sampler = ResourceSampler(queue, interval_s=10.0)
    sampler.start()
    ...
    sampler.stop()
"""

from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from runtrail._queue import WriteQueue

log = logging.getLogger(__name__)

_DEFAULT_INTERVAL_S = 10.0


class ResourceSampler:
    """Daemon thread that periodically samples system resources."""

    def __init__(self, write_queue: WriteQueue, interval_s: float = _DEFAULT_INTERVAL_S) -> None:
        self._q = write_queue
        self._interval = interval_s
        self._stop_event = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            name="runtrail-resource-sampler",
            daemon=True,
        )
        self._nvml_handle: list[Any] = []  # lazy-init inside thread

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=self._interval + 2.0)

    # ── Sampler thread ────────────────────────────────────────────────────────

    def _run(self) -> None:
        self._init_nvml()
        while not self._stop_event.wait(timeout=self._interval):
            try:
                sample = self._sample()
                if sample:
                    from runtrail._queue import LogResource
                    wall_ms = int(time.time() * 1000)
                    self._q.put(LogResource(wall_ms=wall_ms, sample=sample))
            except Exception as exc:
                log.debug("resource sampler error: %s", exc)
        self._shutdown_nvml()

    def _sample(self) -> dict[str, Any]:
        sample: dict[str, Any] = {}

        # CPU + RAM via psutil
        try:
            import psutil
            sample["cpu_percent"] = psutil.cpu_percent(interval=None)
            vm = psutil.virtual_memory()
            sample["ram_used_bytes"] = vm.used
            sample["ram_percent"] = vm.percent
        except Exception:
            pass

        # GPU via pynvml (preferred)
        if self._nvml_handle:
            try:
                import pynvml  # type: ignore[import]
                gpu_samples: list[dict[str, Any]] = []
                for i, h in enumerate(self._nvml_handle):
                    util = pynvml.nvmlDeviceGetUtilizationRates(h)
                    mem = pynvml.nvmlDeviceGetMemoryInfo(h)
                    gpu_samples.append({
                        "index": i,
                        "gpu_percent": util.gpu,
                        "mem_used_bytes": mem.used,
                        "mem_percent": round(mem.used / mem.total * 100, 1) if mem.total else 0,
                    })
                if gpu_samples:
                    sample["gpus"] = gpu_samples
                    # Convenience top-level for single-GPU runs
                    sample["gpu_percent"] = gpu_samples[0]["gpu_percent"]
                    sample["gpu_mem_used_bytes"] = gpu_samples[0]["mem_used_bytes"]
            except Exception:
                pass
        elif not sample.get("gpus"):
            # Fallback: try torch.cuda
            try:
                import torch  # type: ignore[import]
                if torch.cuda.is_available():
                    gpu_samples2: list[dict[str, Any]] = []
                    for i in range(torch.cuda.device_count()):
                        props = torch.cuda.get_device_properties(i)
                        used = torch.cuda.memory_allocated(i)
                        gpu_samples2.append({
                            "index": i,
                            "mem_used_bytes": used,
                            "mem_percent": round(used / props.total_memory * 100, 1) if props.total_memory else 0,
                        })
                    if gpu_samples2:
                        sample["gpus"] = gpu_samples2
                        sample["gpu_mem_used_bytes"] = gpu_samples2[0]["mem_used_bytes"]
            except Exception:
                pass

        return sample

    def _init_nvml(self) -> None:
        try:
            import pynvml  # type: ignore[import]
            pynvml.nvmlInit()
            count = pynvml.nvmlDeviceGetCount()
            self._nvml_handle = [pynvml.nvmlDeviceGetHandleByIndex(i) for i in range(count)]
        except Exception:
            self._nvml_handle = []

    def _shutdown_nvml(self) -> None:
        if self._nvml_handle:
            try:
                import pynvml  # type: ignore[import]
                pynvml.nvmlShutdown()
            except Exception:
                pass
