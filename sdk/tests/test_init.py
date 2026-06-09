"""Phase 0 smoke tests — verify the package imports and version is set."""

import runtrail


def test_version_is_set() -> None:
    assert runtrail.__version__ != ""
    assert runtrail.__version__ is not None


def test_init_returns_run() -> None:
    run = runtrail.init(mode="disabled")
    assert run.id.startswith("run-")
    assert run.project != ""


def test_context_manager() -> None:
    with runtrail.run(mode="disabled") as r:
        r.log({"loss": 0.9})
    assert r._finished is True


def test_log_does_not_raise() -> None:
    run = runtrail.init(mode="disabled")
    for step in range(10):
        run.log({"loss": 1.0 - step * 0.1, "acc": step * 0.1}, step=step)
    run.finish()
