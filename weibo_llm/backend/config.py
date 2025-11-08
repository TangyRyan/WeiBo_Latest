
from pathlib import Path
import os

# 数据目录
DATA_ROOT = Path(os.environ.get("WEIBO_MONITOR_DATA_ROOT", Path(__file__).resolve().parent / "data"))
ARCHIVE_DIR = DATA_ROOT / "archive"            # 每日归档（字典：{事件名: 事件信息}）
HOTLIST_DIR = DATA_ROOT / "hotlist"            # 每小时热榜快照
RISK_DIR    = DATA_ROOT / "risk_warnings"      # 风险预警缓存

# GitHub 热榜数据源
# 结构：{base}/YYYY-MM-DD/HH.json 以及 {base}/YYYY-MM-DD/summary.json
GITHUB_RAW_BASE = "https://raw.githubusercontent.com/lxw15337674/weibo-trending-hot-history/refs/heads/master/api"

# 调度参数
HOUR_CHECK_INTERVAL_MINUTES = int(os.environ.get("HOUR_CHECK_INTERVAL_MINUTES", "5"))

# 每天仅在**特定时间点**运行一次 LLM 评估（Asia/Shanghai 时区）
# ⚠️ 这是可以更改的时间
DAILY_LLM_TIME = os.environ.get("DAILY_LLM_TIME", "09:30")

# 大模型（仅分析：情绪、地区、类型）
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "4898730e-9fcb-4f41-94f8-24776cd02ee5")
OPENAI_MODEL   = os.environ.get("OPENAI_MODEL", "deepseek-r1-250120")

# 风险权重
RISK_WEIGHTS = {
    "negativity": 0.35,
    "growth": 0.25,
    "sensitivity": 0.20,
    "crowd": 0.20
}

# 高敏感类型
HIGH_SENSITIVE = {"时政", "社会", "财经", "军事", "教育"}
# 中等敏感类型
MEDIUM_SENSITIVE = {"科技", "健康", "文化", "能源", "交通", "农业", "公益"}
# 低敏感类型（默认）
LOW_SENSITIVE = {"娱乐", "房产", "时尚", "动漫", "美食", "历史", "文学", "汽车", "旅行", "游戏", "体育", "未知"}

REGION_LIST = [
    "北京","天津","河北","山西","内蒙古","辽宁","吉林","黑龙江","上海","江苏","浙江","安徽","福建","江西","山东",
    "河南","湖北","湖南","广东","广西","海南","重庆","四川","贵州","云南","西藏","陕西","甘肃","青海","宁夏","新疆",
    "香港","澳门","台湾","国外","未知"
]

#从环境变量中读取允许跨域的域名列表（修改为前端域名？）
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*")
