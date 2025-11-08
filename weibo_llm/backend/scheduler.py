
from __future__ import annotations
import threading
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import HOUR_CHECK_INTERVAL_MINUTES, DAILY_LLM_TIME
from .storage import (
    load_hour_hotlist, save_hour_hotlist,
    load_daily_archive, save_daily_archive,
    save_risk_warnings
)
from .fetchers.github_hotlist import build_url_for_hour, fetch_json
from .fetchers.classmate_adapter import get_hourly_hotlist_from_peer, fetch_posts_for_event_from_peer
from .llm.analysis import call_openai
from .risk_model import (
    calc_negativity, calc_growth, calc_sensitivity, calc_crowd, aggregate_score
)

HOTLIST_PUSH = None
RISK_PUSH = None

def set_push_callbacks(hotlist_push_cb, risk_push_cb):
    global HOTLIST_PUSH, RISK_PUSH
    HOTLIST_PUSH, RISK_PUSH = hotlist_push_cb, risk_push_cb

def now_ymd_h():
    now = datetime.now()
    return now.strftime("%Y-%m-%d"), now.strftime("%H")

def list_unprocessed_hours(date_str: str) -> List[str]:
    current_date, current_hour = now_ymd_h()
    upto = int(current_hour) if date_str == current_date else 23
    hours = []
    for h in range(0, upto + 1):
        hh = f"{h:02d}"
        if load_hour_hotlist(date_str, hh) is None:
            hours.append(hh)
    return hours

#统一数据格式
def unify_hotlist_items(raw_items: Any) -> List[Dict[str, Any]]:
    items = []
    if isinstance(raw_items, dict) and "data" in raw_items:
        raw_items = raw_items["data"]
    if isinstance(raw_items, list):
        for i, it in enumerate(raw_items):
            name = it.get("name") or it.get("note") or it.get("title") or it.get("word") or ""
            hot = it.get("hot", it.get("num", 0))
            rank = it.get("rank", i+1)
            items.append({"rank": rank, "name": name, "hot": hot})
    return items

#尝试获取某日某小时的热榜数据
def try_fetch_hour_hotlist(date_str: str, hour: str) -> Optional[List[Dict[str, Any]]]:
    """
    优先使用 GitHub 热榜数据源；
    """
    try:
        # ---------- 1️⃣ 优先使用 GitHub ----------
        url = build_url_for_hour(date_str, hour)
        js = fetch_json(url)
        if js:
            print(f"[GitHub] 成功获取 {date_str}/{hour}.json，共 {len(js)} 条事件。")
            return unify_hotlist_items(js)
        else:
            print(f"[GitHub] {date_str}/{hour}.json 暂无数据或格式为空。")

    except Exception as e:
        print(f"[GitHub] 获取失败: {e}")

    # ---------- 2️⃣ 备用 ----------
    try:
        peer = get_hourly_hotlist_from_peer(date_str, hour)
        if peer:
            print(f"[Peer] 使用接口数据 {date_str} {hour}。")
            return unify_hotlist_items(peer)
        else:
            print(f"[Peer] 接口无返回或格式为空。")
    except Exception as e:
        print(f"[Peer] 接口调用失败: {e}")

    print(f"[Hotlist] {date_str} {hour} 未获取到有效数据。")
    return None


# 将最新抓取的一个小时的热榜数据（items）整合到当日的事件归档文件中，并计算最基础的风险维度——热度增长
def process_hour_hotlist(date_str: str, hour: str, items: List[Dict[str, Any]]):
    """处理一个小时的热榜（不做 LLM；仅更新归档元信息）"""
    save_hour_hotlist(date_str, hour, items)

    archive = load_daily_archive(date_str)

    for it in items:
        name = it["name"]
        hot = it.get("hot", 0.0)
        event = archive.get(name, None)

        if not event:
            event = {
                "event_id": f"{name}-{date_str}",
                "name": name,
                "first_seen_at": f"{date_str}T{hour}:00:00",
                "last_seen_at": f"{date_str}T{hour}:00:00",
                "last_content_update_date": None,
                "hot_values": {f"{date_str}T{hour}:00": hot},
                "hour_list": {f"{date_str}T{hour}:00": it.get("rank", 0)},
                "summary_html": None,
                "posts": [],
                "llm": {"sentiment": 0.0, "region": None, "topic_type": None},
                "risk_dims": {"negativity": 0.0, "growth": 50.0, "sensitivity": 0.0, "crowd": 0.0},
                "risk_score": 0.0
            }
            archive[name] = event
        else:
            event["last_seen_at"] = f"{date_str}T{hour}:00:00"
            event["hot_values"][f"{date_str}T{hour}:00"] = hot
            event["hour_list"][f"{date_str}T{hour}:00"] = it.get("rank", 0)

            # 更新增长维度
            hot_keys = sorted(event["hot_values"].keys())
            prev_hot = event["hot_values"][hot_keys[-2]] if len(hot_keys) >= 2 else None
            growth = calc_growth(hot, prev_hot)
            event["risk_dims"]["growth"] = growth

            archive[name] = event

    save_daily_archive(date_str, archive)

    if HOTLIST_PUSH:
        HOTLIST_PUSH({"date": date_str, "hour": hour, "items": items})

def daily_llm_update():
    """
    每天在固定时间点执行一次：
    - 获取【昨天】的热榜事件
    - 对昨天在热榜中的每个事件调用一次 LLM（情绪/地区/类型）
    - 每个事件每天只分析一次（避免重复计算）
    - 更新 archive[昨天].json 和 risk_warnings.json
    """
    # --- 1️⃣ 获取昨天日期 ---
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    today = datetime.now().strftime("%Y-%m-%d")  # 仅用于标记更新时间
    archive = load_daily_archive(yesterday)
    if not archive:
        print(f"[LLM] 未找到 {yesterday} 的归档文件，跳过。")
        return
    changed = False
    print(f"[LLM] 开始对 {yesterday} 的热榜事件进行分析...")

    # --- 2️⃣ 遍历昨天的所有事件 ---
    for name, ev in archive.items():
        # 判断事件是否昨天已处理过（防止重复计算）
        if ev.get("last_content_update_date") == today:
            continue

        # 从接口获取该事件的前 20 条贴文
        posts = fetch_posts_for_event_from_peer(name, limit=20)
        if not posts:
            print(f"[LLM] {name} 无贴文数据，跳过。")
            continue

        # --- 3️⃣ 调用大模型（仅分析情绪 / 地区 / 类型） ---
        llm_res = call_openai(posts, name)

        # --- 4️⃣ 更新事件记录 ---
        ev["posts"] = posts
        ev["llm"] = {
            "sentiment": llm_res.sentiment,
            "region": llm_res.region,
            "topic_type": llm_res.topic_type
        }

        # --- 5️⃣ 风险维度计算 ---
        negativity = calc_negativity(llm_res.sentiment)
        sensitivity = calc_sensitivity(llm_res.topic_type or "其他")
        crowd = calc_crowd(posts)
        growth = ev.get("risk_dims", {}).get("growth", 50.0)

        ev["risk_dims"] = {
            "negativity": negativity,
            "growth": growth,
            "sensitivity": sensitivity,
            "crowd": crowd
        }
        ev["risk_score"] = aggregate_score(ev["risk_dims"])
        ev["last_content_update_date"] = today

        archive[name] = ev
        changed = True
        print(f"[LLM] {name} 分析完成。")

    # --- 6️⃣ 若有更新则保存归档并刷新风险预警 ---
    if changed:
        save_daily_archive(yesterday, archive)
        warnings = top_risk_warnings(window_days=7, top_k=5)
        save_risk_warnings(warnings)
        print(f"[LLM] {yesterday} 的事件分析已更新，风险预警已刷新。")

        if RISK_PUSH:
            RISK_PUSH(warnings)
    else:
        print(f"[LLM] {yesterday} 无需更新。")


def top_risk_warnings(window_days: int = 7, top_k: int = 5) -> Dict[str, Any]:
    from .storage import ARCHIVE_DIR, read_json
    today = datetime.now().date()
    all_events = []
    for i in range(window_days):
        d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        js = read_json(ARCHIVE_DIR / f"{d}.json", default={}) or {}
        for name, ev in js.items():
            ev_date = ev.get("last_seen_at", f"{d}T00:00:00")[:10]
            recency = (today - datetime.strptime(ev_date, "%Y-%m-%d").date()).days
            score = float(ev.get("risk_score", 0.0))
            sort_key = score - recency * 5.0
            all_events.append({
                "name": name, "date": ev_date, "risk_score": score,
                "llm": ev.get("llm", {}), "risk_dims": ev.get("risk_dims", {}),
                "sort_key": sort_key
            })
    all_events.sort(key=lambda x: x["sort_key"], reverse=True)
    return {"generated_at": datetime.now().isoformat(), "events": all_events[:top_k]}

_scheduler = None
def start_scheduler():
    global _scheduler
    if _scheduler: return _scheduler
    _scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    # 每 HOUR_CHECK_INTERVAL_MINUTES 分钟检查一次当日小时
    _scheduler.add_job(check_current_day_hours, "interval", minutes=HOUR_CHECK_INTERVAL_MINUTES, id="hourly_check")
    # 每天固定时间运行 LLM 任务（默认 09:30）
    hh, mm = DAILY_LLM_TIME.split(":")
    _scheduler.add_job(daily_llm_update, CronTrigger(hour=int(hh), minute=int(mm), timezone="Asia/Shanghai"), id="daily_llm")
    _scheduler.start()
    return _scheduler

def check_current_day_hours():
    today, now_h = now_ymd_h()
    for hh in list_unprocessed_hours(today):
        items = try_fetch_hour_hotlist(today, hh)
        if items:
            process_hour_hotlist(today, hh, items)
    # 尝试补抓昨天漏掉的小时
    y = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    for hh in list_unprocessed_hours(y):
        items = try_fetch_hour_hotlist(y, hh)
        if items:
            process_hour_hotlist(y, hh, items)
