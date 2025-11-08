
from __future__ import annotations
from pathlib import Path
import json
from typing import Any, Dict
from .config import ARCHIVE_DIR, HOTLIST_DIR, RISK_DIR

def _ensure(p: Path):
    p.parent.mkdir(parents=True, exist_ok=True)

def read_json(path: Path, default=None):
    try:
        if path.exists():
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        return default
    return default

def write_json(path: Path, data: Any):
    _ensure(path)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def get_daily_archive_path(date_str: str) -> Path:
    return ARCHIVE_DIR / f"{date_str}.json"

def load_daily_archive(date_str: str) -> Dict[str, Any]:
    return read_json(get_daily_archive_path(date_str), default={}) or {}

def save_daily_archive(date_str: str, data: Dict[str, Any]):
    write_json(get_daily_archive_path(date_str), data)

def get_hour_hotlist_path(date_str: str, hour: str) -> Path:
    return HOTLIST_DIR / date_str / f"{hour}.json"

def load_hour_hotlist(date_str: str, hour: str):
    return read_json(get_hour_hotlist_path(date_str, hour), default=None)

def save_hour_hotlist(date_str: str, hour: str, data: Any):
    write_json(get_hour_hotlist_path(date_str, hour), data)
    write_json(HOTLIST_DIR / "latest.json", {"date": date_str, "hour": hour, "data": data})


def save_risk_warnings(data: Any):
    write_json(RISK_DIR / "latest.json", data)

def load_risk_warnings():
    return read_json(RISK_DIR / "latest.json", default={"events": []})
