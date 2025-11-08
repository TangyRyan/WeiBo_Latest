
# -*- coding: utf-8 -*-
import json
from typing import List, Dict, Any
from dataclasses import dataclass
from ..config import OPENAI_API_KEY, OPENAI_MODEL, REGION_LIST
OPENAI_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
import openai


@dataclass
class LLMResult:
    sentiment: float
    region: str
    topic_type: str

SYSTEM_PROMPT = """你是一个中文舆情分析助手。
给定一个事件及其若干条微博贴文样本，请完成：
1) 事件整体情绪（-1~1，负面到正面）
2) 事件主要涉及的地区（从中国34个省级地区或“国外”中挑一个）
3) 事件类型（娱乐/房产/时尚/动漫/美食/公益/历史/文学/健康/军事/汽车/旅行/游戏/交通/能源/农业/文化/财经/社会/体育/时政/教育/科技/未知）
仅返回JSON，键为 sentiment, region, topic_type。
""" 

def call_openai(posts: List[Dict[str, Any]], event_name: str) -> LLMResult:
    ''' # 若无 openai 库或 API Key，则给一个稳定的占位推断，确保流程不中断
    if openai is None or not OPENAI_API_KEY:
        text = " ".join([p.get("content_text","") for p in posts[:15]])
        topic = "社会"
        if any(k in text for k in ["军机","海警","外交","西沙","涉政","台独","边境","制裁","战争","冲突","安全"]):
            topic = "时政"
        sentiment = -0.15 if topic == "涉政" else 0.0
        region = "未知"
        # 粗略地区启发
        for prov in REGION_LIST:
            if prov in text:
                region = prov
                break
        return LLMResult(sentiment=sentiment, region=region, topic_type=topic)'''

    # 动态构建客户端参数
    client_args = {
        "api_key": OPENAI_API_KEY
    }
    if OPENAI_BASE_URL:  # 如果设置了 Base URL，则传入
        client_args["base_url"] = OPENAI_BASE_URL
    client = openai.OpenAI(**client_args)

    examples = []
    for p in posts[:20]:
        examples.append({
            "published_at": p.get("published_at"),
            "account_name": p.get("account_name"),
            "content_text": p.get("content_text", "")[:500],
            "reposts": p.get("reposts", 0),
            "comments": p.get("comments", 0),
            "likes": p.get("likes", 0)
        })

    user_prompt = {
        "event": event_name,
        "samples": examples,
        "region_candidates": REGION_LIST
    }

    completion = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)}
        ],
        temperature=0.2
    )
    content = completion.choices[0].message.content

    try:
        data = json.loads(content)
        return LLMResult(
            sentiment=float(data.get("sentiment", 0.0)),
            region=str(data.get("region", "未知")),
            topic_type=str(data.get("topic_type", "其他"))
        )
    except Exception:
        return LLMResult(sentiment=0.0, region="未知", topic_type="其他")
