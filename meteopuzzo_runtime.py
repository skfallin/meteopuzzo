from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from meteopuzzo_backend import MeteopuzzoBackend
from meteopuzzo_storage import FilesystemSnapshotStore, resolve_snapshot_store


ROOT_DIR = Path(__file__).resolve().parent


def create_local_backend(root_dir: Path | None = None) -> MeteopuzzoBackend:
    base_dir = (root_dir or ROOT_DIR).resolve()
    return MeteopuzzoBackend(
        base_dir,
        store=FilesystemSnapshotStore(base_dir / "data"),
        backend_name="meteopuzzo-local-backend",
        backend_mode="local-http",
        serves_static_assets=True,
    )


@lru_cache(maxsize=1)
def get_runtime_backend() -> MeteopuzzoBackend:
    return MeteopuzzoBackend(
        ROOT_DIR,
        store=resolve_snapshot_store(ROOT_DIR),
        backend_name="meteopuzzo-vercel-backend",
        backend_mode="vercel-functions",
        serves_static_assets=False,
    )
