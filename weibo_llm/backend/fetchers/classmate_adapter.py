# -*- coding: utf-8 -*-
"""
这里通过 HTTP 调用 API
"""
import requests
from typing import List, Dict, Any, Optional
from datetime import datetime

# ---------- 可配置 ----------
PEER_BASE_URL = "http://127.0.0.1:8766"   
TIMEOUT = 20                              # 请求超时时间（秒）
# ---------------------------

# ⚠️协作点 A：获取某个小时的热榜（如果你们未来想改为由同学提供）
def get_hourly_hotlist_from_peer(date_str: str, hour: str) -> Optional[List[Dict[str, Any]]]:
    """
    调用接口: GET /api/hot_topics/hourly?date=YYYY-MM-DD&hour=H
    返回格式：
    [
      {"rank": 1, "name": "事件标题", "hot": 123456},
      ...
    ]
    """
    try:
        url = f"{PEER_BASE_URL}/api/hot_topics/hourly"
        resp = requests.get(url, params={"date": date_str, "hour": int(hour)}, timeout=TIMEOUT)
        if resp.status_code != 200:
            print(f"[peer_hotlist] 状态码 {resp.status_code}")
            return None
        data = resp.json()
        topics = data.get("topics", [])
        out = []
        for t in topics:
            out.append({
                "rank": t.get("rank") or 0,
                "name": t.get("title") or "",
                "hot": t.get("heat") or 0
            })
        return out
    except Exception as e:
        print(f"[peer_hotlist] 获取失败: {e}")
        return None


# ⚠️获取某个事件的前 20 条贴文（风险/情绪/类型评估用）
def fetch_posts_for_event_from_peer(event_name: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
     GET /api/hot_topics/posts?title=<事件名>&limit=<limit>
    期望返回字段：
      {
        "post_id": "xxxxx",
        "published_at": "2025-01-01T12:34:56",
        "account_name": "某账号",
        "content_text": "正文...",
        "media": ["http://.../a.jpg", "http://.../b.mp4"],
        "reposts": 12,
        "comments": 34,
        "likes": 56
      }
    """
    try:
        url = f"{PEER_BASE_URL}/api/hot_topics/posts"
        resp = requests.get(url, params={"title": event_name, "limit": limit}, timeout=TIMEOUT)
        if resp.status_code != 200:
            print(f"[peer_posts] 状态码 {resp.status_code}")
            return []

        data = resp.json()
        items = data.get("items", [])
        posts: List[Dict[str, Any]] = []
        for i, it in enumerate(items[:limit]):
            # 映射字段
            media = []
            pics = it.get("pics") or []
            for p in pics:
                if isinstance(p, dict) and "url" in p:
                    media.append(p["url"])
            if isinstance(it.get("video"), dict) and "url" in it["video"]:
                media.append(it["video"]["url"])

            # 格式化时间为 ISO 格式
            ts = it.get("created_at")
            if ts and not "T" in ts:
                try:
                    ts = datetime.strptime(ts, "%y-%m-%d %H:%M").strftime("%Y-%m-%dT%H:%M:%S")
                except Exception:
                    ts = str(ts)

            posts.append({
                "post_id": it.get("id") or f"{hash(event_name)%10**6}_{i}",
                "published_at": ts or "",
                "account_name": it.get("user_name") or "未知用户",
                "content_text": it.get("text") or "",
                "media": media,
                "reposts": int(it.get("reposts", 0)),
                "comments": int(it.get("comments", 0)),
                "likes": int(it.get("likes", 0))
            })
        return posts
    except Exception as e:
        print(f"[peer_posts] 获取失败: {e}")
        return []
