# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Tuple

from ..config import OPENAI_API_KEY, OPENAI_MODEL, REGION_LIST

OPENAI_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
MAX_SAMPLE_POSTS = 20

try:
    import openai  # openai>=1.x
except Exception:  # pragma: no cover - optional dependency
    openai = None

logger = logging.getLogger(__name__)


@dataclass
class LLMResult:
    sentiment: float
    region: str
    topic_type: str
    raw_content: str = ""
    payload: Dict[str, Any] = field(default_factory=dict)
    source: str = "llm"


SYSTEM_PROMPT = """你是一个中文舆情分析助手。给定一个事件及其若干条微博贴文样本，请完成：1) 事件整体情绪（-1~1，负面到正面）2) 事件主要涉及的地区（从中国34个省级地区或“国外”中挑一个）
3) 事件类型（娱乐/房产/时尚/动漫/美食/公益/历史/文学/健康/军事/汽车/旅行/游戏/交通/能源/农业/文化/财经/社会/体育/时政/教育/科技/未知）。仅返回JSON，键：sentiment, region, topic_type。"""

THINK_PATTERN = re.compile(r"<think>.*?</think>", flags=re.IGNORECASE | re.DOTALL)
CODE_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(.*?)```", flags=re.IGNORECASE | re.DOTALL)
KV_PATTERN = re.compile(
    r"^\s*(sentiment|情绪|region|地区|topic_type|topic|类型)\s*[:：=]\s*(.+?)\s*$",
    flags=re.IGNORECASE,
)
SENTIMENT_WORD_MAP = {
    "positive": 0.6,
    "pos": 0.6,
    "positive emotion": 0.6,
    "正面": 0.6,
    "积极": 0.6,
    "neutral": 0.0,
    "neut": 0.0,
    "中性": 0.0,
    "negative": -0.6,
    "neg": -0.6,
    "负面": -0.6,
    "消极": -0.6,
}


def call_openai(posts: List[Dict[str, Any]], event_name: str) -> LLMResult:
    """Invoke the LLM (if configured) and coerce its reply into structured data."""
    if openai is None or not OPENAI_API_KEY:
        logger.warning(
            "LLM disabled or missing API key; using heuristic fallback for %s",
            event_name,
        )
        return _heuristic_inference(posts, event_name, source="heuristic:no_api")

    client_args = {"api_key": OPENAI_API_KEY}
    if OPENAI_BASE_URL:
        client_args["base_url"] = OPENAI_BASE_URL
    client = openai.OpenAI(**client_args)

    examples = []
    for post in posts[:MAX_SAMPLE_POSTS]:
        examples.append({
            "published_at": post.get("published_at"),
            "account_name": post.get("account_name"),
            "content_text": (post.get("content_text") or "")[:500],
            "reposts": post.get("reposts", 0),
            "comments": post.get("comments", 0),
            "likes": post.get("likes", 0),
        })

    user_prompt = {
        "event": event_name,
        "samples": examples,
        "region_candidates": REGION_LIST,
    }
    logger.info("Requesting LLM analysis for %s with %s samples", event_name, len(examples))

    try:
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
            ],
            temperature=0.2,
        )
    except Exception as exc:  # pragma: no cover - network failures
        logger.exception("LLM request failed for %s: %s", event_name, exc)
        return _heuristic_inference(posts, event_name, source="heuristic:exception")

    content = completion.choices[0].message.content or ""
    payload, extracted = _structured_payload_from_content(content)
    if not payload:
        logger.warning("LLM response for %s lacked structured payload; falling back", event_name)
        return _heuristic_inference(posts, event_name, raw_content=content, source="heuristic:unparsed")

    result = _build_llm_result(payload, content)
    logger.info(
        "LLM parsed for %s: sentiment=%.2f region=%s topic=%s",
        event_name,
        result.sentiment,
        result.region,
        result.topic_type,
    )
    logger.debug("Structured payload for %s: %s", event_name, extracted)
    return result


def _heuristic_inference(
    posts: List[Dict[str, Any]],
    event_name: str,
    *,
    raw_content: str = "",
    source: str = "heuristic",
) -> LLMResult:
    text = " ".join((p.get("content_text") or "") for p in posts[:15])
    topic = "社会"
    sensitive_keywords = ["军机", "海警", "外交", "西沙", "涉政", "台独", "边境", "制裁", "战争", "冲突", "安全"]
    if any(keyword in text for keyword in sensitive_keywords):
        topic = "时政"
    sentiment = -0.15 if topic == "时政" else 0.0
    region = "未知"
    for prov in REGION_LIST:
        if prov and prov in text:
            region = prov
            break
    logger.debug(
        "Heuristic inference for %s -> sentiment=%.2f region=%s topic=%s",
        event_name,
        sentiment,
        region,
        topic,
    )
    return LLMResult(
        sentiment=sentiment,
        region=region,
        topic_type=topic,
        raw_content=raw_content,
        payload={"source": source},
        source=source,
    )


def _structured_payload_from_content(raw: str) -> Tuple[Dict[str, Any], str]:
    cleaned = _strip_reasoning(raw)
    for candidate in _iter_json_candidates(cleaned):
        data = _safe_json_dict(candidate)
        if data:
            return data, candidate
    kv_payload = _parse_key_value_lines(cleaned)
    if kv_payload:
        return kv_payload, cleaned
    return {}, cleaned


def _strip_reasoning(content: str) -> str:
    if not content:
        return ""
    return THINK_PATTERN.sub("", content).strip()


def _iter_json_candidates(content: str) -> Iterable[str]:
    seen = set()
    if content:
        cleaned = content.strip()
        if cleaned:
            seen.add(cleaned)
            yield cleaned
    for match in CODE_FENCE_PATTERN.finditer(content):
        candidate = (match.group(1) or "").strip()
        if candidate and candidate not in seen:
            seen.add(candidate)
            yield candidate
    for block in _extract_brace_blocks(content):
        trimmed = block.strip()
        if trimmed and trimmed not in seen:
            seen.add(trimmed)
            yield trimmed


def _extract_brace_blocks(content: str) -> List[str]:
    blocks: List[str] = []
    depth = 0
    start = None
    for idx, char in enumerate(content):
        if char == "{":
            if depth == 0:
                start = idx
            depth += 1
        elif char == "}":
            if depth:
                depth -= 1
                if depth == 0 and start is not None:
                    blocks.append(content[start:idx + 1])
                    start = None
    return blocks


def _parse_key_value_lines(content: str) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    for line in content.splitlines():
        match = KV_PATTERN.match(line.strip())
        if not match:
            continue
        key, value = match.groups()
        normalized_key = _normalize_key(key)
        payload[normalized_key] = value.strip().strip(",")
    return payload


def _normalize_key(key: str) -> str:
    lower = key.lower()
    if lower in {"sentiment", "情绪"}:
        return "sentiment"
    if lower in {"region", "地区"}:
        return "region"
    return "topic_type"


def _safe_json_dict(candidate: str) -> Dict[str, Any]:
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return {}
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict):
            return first
        return {}
    if isinstance(data, dict):
        return data
    return {}


def _coerce_sentiment(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        score = float(value)
    elif isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return 0.0
        try:
            score = float(candidate)
        except ValueError:
            score = SENTIMENT_WORD_MAP.get(candidate.lower(), 0.0)
    else:
        return 0.0
    return max(-1.0, min(1.0, score))


def _normalize_region(value: Any) -> str:
    if not value:
        return "未知"
    region = str(value).strip()
    if not region:
        return "未知"
    if region in REGION_LIST:
        return region
    core = region
    for suffix in ["省", "市", "壮族自治区", "维吾尔自治区", "回族自治区", "自治区"]:
        core = core.replace(suffix, "")
    for candidate in REGION_LIST:
        if candidate == "未知":
            continue
        if candidate in region or core in candidate:
            return candidate
    return "国外" if "国" in region and region not in REGION_LIST else "未知"


def _normalize_topic_type(value: Any) -> str:
    topic = str(value or "").strip()
    if not topic:
        return "其他"
    return topic


def _build_llm_result(payload: Dict[str, Any], raw_content: str) -> LLMResult:
    sentiment = _coerce_sentiment(
        payload.get("sentiment")
        or payload.get("sentiment_score")
        or payload.get("score")
    )
    region = _normalize_region(
        payload.get("region") or payload.get("region_name") or payload.get("地区")
    )
    topic_type = _normalize_topic_type(
        payload.get("topic_type") or payload.get("topic") or payload.get("类型")
    )
    return LLMResult(
        sentiment=sentiment,
        region=region,
        topic_type=topic_type,
        raw_content=raw_content,
        payload=payload,
        source="llm",
    )
