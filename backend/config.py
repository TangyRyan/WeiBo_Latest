"""Backend-wide configuration derived from shared settings."""

from __future__ import annotations

import os
from pathlib import Path

from .settings import DATA_ROOT, get_env_bool, get_env_int, get_env_str

# 路径统一：与 spider/daily_heat.py 中保持一致
ARCHIVE_DIR = DATA_ROOT / "hot_topics"
HOURLY_DIR = ARCHIVE_DIR / "hourly"
POST_DIR = DATA_ROOT / "posts"
AICARD_DIR = DATA_ROOT / "aicard"
RISK_DIR = DATA_ROOT / "risk_warnings"
HOTLIST_DIR = HOURLY_DIR  # 兼容旧接口，指向小时榜路径

for _path in [
    ARCHIVE_DIR,
    HOURLY_DIR,
    POST_DIR,
    AICARD_DIR,
    RISK_DIR,
]:
    _path.mkdir(parents=True, exist_ok=True)

# 外部 GitHub 数据源
GITHUB_RAW_BASE = (
    "https://raw.githubusercontent.com/lxw15337674/weibo-trending-hot-history/refs/heads/master/api"
)

# 调度配置
HOUR_CHECK_INTERVAL_MINUTES = get_env_int("HOUR_CHECK_INTERVAL_MINUTES", 5) or 5
DAILY_LLM_TIME = get_env_str("DAILY_LLM_TIME", "09:30") or "09:30"
MONITOR_ENABLED = get_env_bool("WEIBO_MONITOR_ENABLED", True)
LLM_ENABLED = get_env_bool("WEIBO_LLM_ENABLED", True)
LLM_ANALYSIS_WORKERS = max(1, get_env_int("LLM_ANALYSIS_WORKERS", 3) or 3)
LLM_ANALYSIS_TOP_K = max(1, get_env_int("LLM_ANALYSIS_TOP_K", 50) or 50)

# 大模型
OPENAI_API_KEY = get_env_str("OPENAI_API_KEY", "")
OPENAI_MODEL = get_env_str("OPENAI_MODEL", "deepseek-r1-250120")

# 风险评分
RISK_WEIGHTS = {
    "negativity": 0.35,
    "growth": 0.25,
    "sensitivity": 0.20,
    "crowd": 0.20,
}

HIGH_SENSITIVE = {"时政", "社会", "财经", "军事", "教育"}
MEDIUM_SENSITIVE = {"科技", "健康", "文化", "能源", "交通", "农业", "公益"}
LOW_SENSITIVE = {
    "娱乐",
    "房产",
    "时尚",
    "动漫",
    "美食",
    "历史",
    "文学",
    "汽车",
    "旅行",
    "游戏",
    "体育",
    "未知",
}

REGION_LIST = [
    "北京",
    "天津",
    "河北",
    "山西",
    "内蒙古",
    "辽宁",
    "吉林",
    "黑龙江",
    "上海",
    "江苏",
    "浙江",
    "安徽",
    "福建",
    "江西",
    "山东",
    "河南",
    "湖北",
    "湖南",
    "广东",
    "广西",
    "海南",
    "重庆",
    "四川",
    "贵州",
    "云南",
    "西藏",
    "陕西",
    "甘肃",
    "青海",
    "宁夏",
    "新疆",
    "香港",
    "澳门",
    "台湾",
    "国外",
    "未知",
]

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*")

__all__ = [
    "ARCHIVE_DIR",
    "HOURLY_DIR",
    "HOTLIST_DIR",
    "POST_DIR",
    "AICARD_DIR",
    "RISK_DIR",
    "GITHUB_RAW_BASE",
    "HOUR_CHECK_INTERVAL_MINUTES",
    "MONITOR_ENABLED",
    "LLM_ENABLED",
    "LLM_ANALYSIS_WORKERS",
    "LLM_ANALYSIS_TOP_K",
    "DAILY_LLM_TIME",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "RISK_WEIGHTS",
    "HIGH_SENSITIVE",
    "MEDIUM_SENSITIVE",
    "LOW_SENSITIVE",
    "REGION_LIST",
    "ALLOWED_ORIGINS",
]
