import json
import os
from backend.storage import load_daily_archive, save_daily_archive
from spider.update_posts import ensure_topic_posts

DATE = "2025-11-18"
LIMIT = int(os.environ.get("FILL_POSTS_LIMIT") or 0) or None

archive = load_daily_archive(DATE)
missing = []
for name, event in archive.items():
    detail = (event.get("llm_status") or {}).get("detail")
    has_posts = bool((event.get("latest_posts") or {}).get("items")) or bool(event.get("post_output"))
    if detail == "no_posts" and not has_posts:
        missing.append(name)
if LIMIT is not None:
    pending = missing[:LIMIT]
else:
    pending = missing[:]

report = {"targets": pending, "refreshed": [], "errors": []}
for name in pending:
    record = archive.get(name)
    if not record:
        report["errors"].append({"name": name, "error": "missing_record"})
        continue
    before = len((record.get("latest_posts") or {}).get("items") or [])
    try:
        updated = ensure_topic_posts(name, record, DATE)
    except Exception as exc:  # noqa: W0703
        report["errors"].append({"name": name, "error": str(exc)})
        continue
    archive[name] = updated
    after = len((updated.get("latest_posts") or {}).get("items") or [])
    report["refreshed"].append({
        "name": name,
        "before": before,
        "after": after,
        "post_output": updated.get("post_output"),
    })
    save_daily_archive(DATE, archive)

print(json.dumps(report, ensure_ascii=False, indent=2))
