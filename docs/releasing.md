# Releasing & citation

This project is set up so that each tagged release produces installable binaries,
a PyPI package, and (once Zenodo is connected) a citable DOI — the pieces that
make the work usable and creditable in an academic setting.

## Cutting a release

1. Update [`CHANGELOG.md`](../CHANGELOG.md) with the new version's notes.
2. Bump the version in three places so they agree:
   - `sdk/pyproject.toml` (`version = "X.Y.Z"`)
   - `sdk/runtrail/__init__.py` (`__version__`)
   - `CITATION.cff` (`version` and `date-released`)
3. Commit, then tag and push:

   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

The tag triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which cross-compiles the five platform binaries, attaches them (plus checksums)
to a GitHub Release, and publishes the Python SDK to PyPI.

> The Go binary's version is injected at build time via
> `-X github.com/parsa-hke/runtrail/internal/version.Version=X.Y.Z`, so the tag is
> the single source of truth — no Go source edit needed.

### Prerequisite secret

The PyPI job authenticates with a `PYPI_API_TOKEN` repository secret
(Settings → Secrets and variables → Actions). Alternatively, switch the job to
PyPI Trusted Publishing (OIDC) to avoid storing a token.

## Getting a citable DOI (Zenodo)

A DOI gives you a permanent, citable reference for each release — the thing you
put on a CV or in a paper.

1. Sign in at <https://zenodo.org> with your GitHub account.
2. Go to **Settings → GitHub** and flip the toggle **on** for
   `parsa-hke/runtrail`.
3. Cut a GitHub Release (the tag step above creates one). Zenodo automatically
   archives it and mints a DOI.
4. Copy the DOI into `CITATION.cff` (uncomment the `doi:` line) and into the
   README badge, then commit.

Zenodo issues a *concept DOI* that always resolves to the latest version, plus a
per-release DOI. Cite the concept DOI for "the software," a version DOI for "the
exact version used."

## How others will cite it

GitHub renders a **"Cite this repository"** button from `CITATION.cff`, giving
visitors ready-made APA/BibTeX. Example BibTeX once a DOI exists:

```bibtex
@software{hosseini_runtrail_2026,
  author  = {Hosseini, Parsa},
  title   = {runtrail: a local-first experiment tracker for solo ML researchers},
  year    = {2026},
  version = {0.1.0},
  doi     = {10.5281/zenodo.XXXXXXX},
  url     = {https://github.com/parsa-hke/runtrail}
}
```
