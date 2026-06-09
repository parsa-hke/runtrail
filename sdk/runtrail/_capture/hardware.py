"""Capture hardware info: CPU, RAM, GPU(s), OS.

Uses psutil for system info and pynvml for GPU (optional).
Never raises — returns partial data on any failure.
"""

from __future__ import annotations

import logging
import os
import platform
import socket
from typing import Any

log = logging.getLogger(__name__)


def capture() -> dict[str, Any]:
    """Return hardware metadata dict."""
    hw: dict[str, Any] = {
        "cpu": _cpu_model(),
        "cpu_count_physical": _cpu_count_physical(),
        "cpu_count_logical": os.cpu_count(),
        "ram_bytes": _ram_bytes(),
        "os": platform.platform(),
        "kernel": platform.release(),
        "hostname": _hostname(),
        "arch": platform.machine(),
        "gpus": _gpus(),
    }
    # Convenience top-level fields matching the prototype data shape
    gpus = hw["gpus"]
    if gpus:
        hw["gpu"] = gpus[0].get("name", "unknown")
        hw["gpu_count"] = len(gpus)
    else:
        hw["gpu"] = None
        hw["gpu_count"] = 0

    hw["ram"] = _ram_human(hw["ram_bytes"])
    return hw


# ── CPU ──────────────────────────────────────────────────────────────────────

def _cpu_model() -> str:
    # Linux
    try:
        with open("/proc/cpuinfo", encoding="utf-8") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    # macOS
    try:
        import subprocess
        out = subprocess.check_output(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            stderr=subprocess.DEVNULL, timeout=5,
        )
        return out.decode().strip()
    except Exception:
        pass
    return platform.processor() or "unknown"


def _cpu_count_physical() -> int | None:
    try:
        import psutil
        return psutil.cpu_count(logical=False)
    except Exception:
        return None


# ── RAM ──────────────────────────────────────────────────────────────────────

def _ram_bytes() -> int:
    try:
        import psutil
        return psutil.virtual_memory().total
    except Exception:
        return 0


def _ram_human(n_bytes: int) -> str:
    if n_bytes == 0:
        return "unknown"
    gib = n_bytes / (1024 ** 3)
    return f"{gib:.0f} GiB"


# ── GPU ──────────────────────────────────────────────────────────────────────

def _gpus() -> list[dict[str, Any]]:
    # 1. Try pynvml (fastest, most complete)
    try:
        import pynvml  # type: ignore[import]
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        result = []
        for i in range(count):
            h = pynvml.nvmlDeviceGetHandleByIndex(i)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            result.append({
                "index": i,
                "name": pynvml.nvmlDeviceGetName(h),
                "memory_bytes": mem.total,
                "memory": _ram_human(mem.total),
                "driver": _nvml_driver(pynvml),
            })
        return result
    except Exception:
        pass

    # 2. Try nvidia-smi subprocess
    try:
        import subprocess
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=index,name,memory.total,driver_version",
                "--format=csv,noheader,nounits",
            ],
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
        result2 = []
        for line in out.decode().strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 4:
                result2.append({
                    "index": int(parts[0]),
                    "name": parts[1],
                    "memory": f"{int(parts[2]) // 1024} GiB",
                    "memory_bytes": int(parts[2]) * 1024 * 1024,
                    "driver": parts[3],
                })
        return result2
    except Exception:
        pass

    # 3. Try torch.cuda
    try:
        import torch  # type: ignore[import]
        if torch.cuda.is_available():
            return [
                {
                    "index": i,
                    "name": torch.cuda.get_device_name(i),
                    "memory_bytes": torch.cuda.get_device_properties(i).total_memory,
                    "memory": _ram_human(torch.cuda.get_device_properties(i).total_memory),
                }
                for i in range(torch.cuda.device_count())
            ]
    except Exception:
        pass

    return []


def _nvml_driver(pynvml: Any) -> str:
    try:
        return pynvml.nvmlSystemGetDriverVersion()
    except Exception:
        return "unknown"


def _hostname() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return "unknown"
