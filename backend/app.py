from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from flask_sock import Sock

from backend.config import ALLOWED_ORIGINS, ARCHIVE_DIR, HOTLIST_DIR, DAILY_LLM_TIME
from backend.hotlist_stream import HotTopicsHotlistStream
from backend.scheduler import daily_llm_update, set_push_callbacks, start_scheduler, top_risk_warnings
from backend.storage import (
    load_daily_archive,
    load_risk_archive,
    load_risk_warnings,
    read_json,
    save_risk_archive,
    save_risk_warnings,
)
from spider.hot_topics_api import bp as hot_topics_bp

BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(BASE_DIR / "static"), template_folder=str(BASE_DIR / "templates"))
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}})
app.register_blueprint(hot_topics_bp)
sock = Sock(app)

logger = logging.getLogger(__name__)

_hotlist_clients = set()
_risk_clients = set()
_hotlist_stream: HotTopicsHotlistStream | None = None


def _latest_risk_payload(limit: int | None = 5) -> Dict[str, Any]:
    """Return the cached risk warnings sorted and capped for display."""
    payload = load_risk_warnings() or {}
    events = payload.get("events")
    if not events:
        today = datetime.now().strftime("%Y-%m-%d")
        archive_payload = load_risk_archive(today)
        archive_events = archive_payload.get("events")
        if archive_events:
            payload = archive_payload
            events = archive_events
        else:
            payload = top_risk_warnings()
            events = payload.get("events")
            if events:
                save_risk_archive(today, payload)
        if events:
            save_risk_warnings(payload)
    if limit is None or not isinstance(events, list):
        return payload
    def _score(ev: Dict[str, Any]) -> float:
        raw = ev.get("sort_key")
        if raw is None:
            raw = ev.get("risk_score", 0.0)
        try:
            return float(raw or 0.0)
        except (TypeError, ValueError):
            return 0.0
    sorted_events = sorted(
        events,
        key=_score,
        reverse=True,
    )
    return {**payload, "events": sorted_events[:limit]}


def _broadcast(clients, message: Dict[str, Any]) -> None:
    drop = []
    for ws in list(clients):
        try:
            ws.send(json.dumps(message, ensure_ascii=False))
        except Exception:
            drop.append(ws)
    for ws in drop:
        clients.discard(ws)


def _coerce_hot_number(raw: Any) -> float:
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        text = raw.strip().lower().replace(",", "")
        if not text:
            return 0.0
        multiplier = 1.0
        if text.endswith(("w", "万")):
            text = text[:-1]
            multiplier = 10000.0
        try:
            return float(text) * multiplier
        except ValueError:
            return 0.0
    return 0.0


def _extract_event_heat(event: Dict[str, Any]) -> float:
    hot_values = event.get("hot_values")
    if isinstance(hot_values, dict) and hot_values:
        try:
            latest_key = max(hot_values.keys())
            return _coerce_hot_number(hot_values.get(latest_key))
        except Exception:
            pass
    for key in ("hot", "heat", "score"):
        if key in event:
            value = _coerce_hot_number(event.get(key))
            if value:
                return value
    return 0.0


def push_hotlist(message: Dict[str, Any]) -> None:
    _broadcast(_hotlist_clients, message)


def push_risk(message: Dict[str, Any]) -> None:
    _broadcast(_risk_clients, message)


def _noop_hotlist_push(_: Dict[str, Any]) -> None:
    logger.debug("Scheduler hotlist push ignored (using spider.hot_topics_ws stream)")


set_push_callbacks(_noop_hotlist_push, push_risk)


def _ensure_hotlist_stream() -> None:
    global _hotlist_stream
    if _hotlist_stream is None:
        _hotlist_stream = HotTopicsHotlistStream(push_hotlist)


_ensure_hotlist_stream()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/daily_30")
def daily_30():
    end = datetime.now().date()
    start = end - timedelta(days=29)
    out = []
    for i in range(30):
        d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        archive = load_daily_archive(d)
        heat_total = 0.0
        risk_total = 0.0
        for event in archive.values():
            if isinstance(event, dict):
                heat_total += _extract_event_heat(event)
                risk_total += float(event.get("risk_score", 0.0))
        out.append({"date": d, "heat": heat_total, "risk": risk_total})
    return jsonify({"data": out})


@app.route("/api/hotlist/current")
def hotlist_current():
    data = read_json(HOTLIST_DIR / "latest.json", default=None)
    return jsonify(data or {"date": None, "hour": None, "data": []})


@app.route("/api/risk/latest")
def risk_latest():
    return jsonify(_latest_risk_payload())


@app.route("/api/risk/archive")
def risk_archive():
    date = request.args.get("date")
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    snapshot = load_risk_archive(date)
    events = snapshot.get("events")
    if not events:
        return jsonify({"error": "risk archive not found", "date": date}), 404
    response = dict(snapshot)
    response.setdefault("date", date)
    return jsonify(response)


@app.route("/api/risk/event")
def risk_event():
    name = request.args.get("name")
    date = request.args.get("date")
    if not name or not date:
        return jsonify({"error": "name and date are required"}), 400
    archive = load_daily_archive(date)
    event = archive.get(name)
    if not event:
        return jsonify({"error": "event not found"}), 404
    response = {
        "name": name,
        "date": date,
        "risk_score": event.get("risk_score"),
        "risk_dims": event.get("risk_dims", {}),
        "llm": event.get("llm", {}),
        "summary_html": event.get("summary_html"),
        "posts": event.get("posts") or [],
    }
    return jsonify(response)


@app.route("/api/central_data")
def central_data():
    range_opt = request.args.get("range", "week")
    days = {"week": 7, "month": 30, "halfyear": 182}.get(range_opt, 7)
    _ = request.args.get("color", "领域")
    end = datetime.now().date()
    out = []
    seen = set()
    for i in range(days):
        d = (end - timedelta(days=i)).strftime("%Y-%m-%d")
        arc = load_daily_archive(d)
        for name, ev in arc.items():
            if name in seen:
                continue
            llm = ev.get("llm")
            if not llm:
                continue
            seen.add(name)
            risk_value = float(ev.get("risk_score", 0.0))
            out.append({
                "name": name,
                "date": ev.get("last_seen_at", f"{d}T00:00:00")[:10],
                "领域": llm.get("topic_type") or "其他",
                "地区": llm.get("region") or "国外",
                "情绪": float(llm.get("sentiment", 0.0)),
                "风险": risk_value,
                "风险值": risk_value,
                "热度": _extract_event_heat(ev),
            })
    return jsonify({"data": out})


@app.route("/api/admin/run_daily_llm", methods=["POST", "GET"])
def run_daily_llm():
    target_date = request.args.get("date")
    if target_date:
        try:
            datetime.strptime(target_date, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": "invalid date format, expected YYYY-MM-DD"}), 400
    logger.info("Manual daily LLM trigger invoked via /api/admin/run_daily_llm (date=%s)", target_date or "yesterday")
    daily_llm_update(target_date=target_date, force=True)
    return jsonify({
        "ok": True,
        "ran_at": datetime.now().isoformat(),
        "scheduled_time": DAILY_LLM_TIME,
        "target_date": target_date,
    })


@sock.route("/ws/hotlist")
def ws_hotlist(ws):
    _hotlist_clients.add(ws)
    initial_payload = _hotlist_stream.latest_payload() if _hotlist_stream else None
    if initial_payload:
        try:
            ws.send(json.dumps(initial_payload, ensure_ascii=False))
        except Exception:
            logger.exception("Failed to send initial hotlist snapshot")
    try:
        while True:
            ws.receive()
    except Exception:
        pass
    finally:
        _hotlist_clients.discard(ws)


@sock.route("/ws/risk_warnings")
def ws_risk(ws):
    _risk_clients.add(ws)
    initial_payload = _latest_risk_payload()
    if initial_payload:
        try:
            ws.send(json.dumps(initial_payload, ensure_ascii=False))
        except Exception:
            logger.exception("Failed to send initial risk snapshot")
    try:
        while True:
            ws.receive()
    except Exception:
        pass
    finally:
        _risk_clients.discard(ws)


def create_app():
    start_scheduler()
    return app


if __name__ == "__main__":
    start_scheduler()
    app.run(host="0.0.0.0", port=8000)
