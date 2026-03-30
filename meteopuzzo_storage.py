from __future__ import annotations

import asyncio
import json
import os
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Iterator


SNAPSHOT_FILENAMES = ("latest.csv", "series.json", "status.json")
SNAPSHOT_CONTENT_TYPES = {
    "latest.csv": "text/csv; charset=utf-8",
    "series.json": "application/json; charset=utf-8",
    "status.json": "application/json; charset=utf-8",
}


class SnapshotStore:
    kind = "unknown"

    @contextmanager
    def create_output_dir(self) -> Iterator[Path]:
        raise NotImplementedError

    def publish_directory(self, output_dir: Path) -> None:
        raise NotImplementedError

    def load_snapshot(self) -> dict[str, Any]:
        raise NotImplementedError

    def describe(self) -> dict[str, Any]:
        raise NotImplementedError


class FilesystemSnapshotStore(SnapshotStore):
    kind = "filesystem"

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir.resolve()

    @contextmanager
    def create_output_dir(self) -> Iterator[Path]:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        yield self.data_dir

    def publish_directory(self, output_dir: Path) -> None:
        if output_dir.resolve() != self.data_dir:
            raise RuntimeError("Filesystem snapshot store expected direct writes into the data directory")

    def load_snapshot(self) -> dict[str, Any]:
        return {
            "series": _load_json_file(self.data_dir / "series.json"),
            "status": _load_json_file(self.data_dir / "status.json"),
        }

    def describe(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "location": str(self.data_dir),
            "dataDirectory": self.data_dir.name,
        }


class BlobSnapshotStore(SnapshotStore):
    kind = "vercel-blob"

    def __init__(
        self,
        prefix: str,
        *,
        access: str = "private",
    ) -> None:
        self.prefix = prefix.strip("/")
        self.access = access

    @contextmanager
    def create_output_dir(self) -> Iterator[Path]:
        with TemporaryDirectory(prefix="meteopuzzo-") as temp_dir:
            output_dir = Path(temp_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            yield output_dir

    def publish_directory(self, output_dir: Path) -> None:
        for filename in SNAPSHOT_FILENAMES:
            path = output_dir / filename
            if not path.exists():
                raise FileNotFoundError(f"Missing generated artifact for blob publish: {path}")
            _blob_put(
                self._pathname(filename),
                path.read_bytes(),
                access=self.access,
                content_type=SNAPSHOT_CONTENT_TYPES[filename],
                overwrite=True,
            )

    def load_snapshot(self) -> dict[str, Any]:
        return {
            "series": self._load_json_blob("series.json"),
            "status": self._load_json_blob("status.json"),
        }

    def describe(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "prefix": self.prefix,
            "access": self.access,
        }

    def _pathname(self, filename: str) -> str:
        return f"{self.prefix}/{filename}" if self.prefix else filename

    def _load_json_blob(self, filename: str) -> dict[str, Any]:
        result = _blob_get(self._pathname(filename), access=self.access)
        if result is None or result.status_code != 200 or result.stream is None:
            raise FileNotFoundError(f"Missing blob snapshot: {self._pathname(filename)}")

        raw_bytes = _consume_stream(result.stream)
        payload = json.loads(raw_bytes.decode("utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError(f"Blob snapshot is not a JSON object: {self._pathname(filename)}")
        return payload


def resolve_snapshot_store(root_dir: Path, *, mode: str | None = None) -> SnapshotStore:
    selected_mode = (mode or os.getenv("METEOPUZZO_STORAGE", "auto")).strip().lower()
    if selected_mode not in {"auto", "filesystem", "blob"}:
        raise RuntimeError(f"Unsupported METEOPUZZO_STORAGE value: {selected_mode}")

    if selected_mode == "blob" or (selected_mode == "auto" and os.getenv("BLOB_READ_WRITE_TOKEN")):
        return BlobSnapshotStore(resolve_blob_prefix())

    output_dir = Path(os.getenv("METEOPUZZO_OUTPUT_DIR", "data"))
    if not output_dir.is_absolute():
        output_dir = root_dir / output_dir
    return FilesystemSnapshotStore(output_dir)


def resolve_blob_prefix() -> str:
    configured = os.getenv("METEOPUZZO_BLOB_PREFIX", "").strip().strip("/")
    if configured:
        return configured

    environment = os.getenv("VERCEL_ENV", "development").strip() or "development"
    return f"meteopuzzo/{environment}"


def _blob_put(pathname: str, body: bytes, *, access: str, content_type: str, overwrite: bool) -> Any:
    try:
        from vercel.blob import put
    except ImportError as exc:  # pragma: no cover - depends on optional runtime dependency
        raise RuntimeError("Blob storage requires the `vercel` Python package. Install the project requirements.") from exc

    return put(
        pathname,
        body,
        access=access,
        content_type=content_type,
        overwrite=overwrite,
    )


def _blob_get(pathname: str, *, access: str) -> Any:
    try:
        from vercel.blob import get
    except ImportError as exc:  # pragma: no cover - depends on optional runtime dependency
        raise RuntimeError("Blob storage requires the `vercel` Python package. Install the project requirements.") from exc

    return get(pathname, access=access)


def _load_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Missing snapshot file: {path}")

    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)

    if not isinstance(payload, dict):
        raise RuntimeError(f"Snapshot file is not a JSON object: {path}")
    return payload


def _consume_stream(stream: Any) -> bytes:
    if isinstance(stream, (bytes, bytearray)):
        return bytes(stream)

    if hasattr(stream, "__aiter__"):
        async def consume_async() -> bytes:
            chunks: list[bytes] = []
            async for chunk in stream:
                chunks.append(bytes(chunk))
            return b"".join(chunks)

        return asyncio.run(consume_async())

    if hasattr(stream, "__iter__"):
        return b"".join(bytes(chunk) for chunk in stream)

    raise RuntimeError("Unsupported blob stream type returned by the Vercel Blob SDK")
