
from __future__ import annotations
from flask import Flask, jsonify, request,render_template
from flask_cors import CORS    #CORS 扩展可轻松配置跨域规则，允许指定的域名访问后端接口
from flask_sock import Sock
from datetime import datetime, timedelta
from typing import Dict, Any
from .storage import load_daily_archive, read_json, load_risk_warnings
from .config import ALLOWED_ORIGINS, ARCHIVE_DIR, HOTLIST_DIR, DAILY_LLM_TIME
from .scheduler import start_scheduler, set_push_callbacks, daily_llm_update

from backend import storage
import json

#静态文件目录 模板文件目录
app = Flask(__name__, static_folder="static", template_folder="templates")
#用于仅允许指定域名访问后端接口 r"/api/*"是一个正则表达式
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}})
sock = Sock(app)

_hotlist_clients = set()
_risk_clients = set()


#向所有连接的客户端广播消息
def _broadcast(clients, message: Dict[str, Any]):
    drop = []
    for ws in list(clients):
        try:
            #get_data() 是 Response 对象的方法，参数 as_text=True 表示将字节流转换为 字符串类型
            ws.send(jsonify(message).get_data(as_text=True))
        except Exception:
            drop.append(ws)
    
    # 清理断开的连接
    for ws in drop:
        clients.discard(ws)

def push_hotlist(message: Dict[str, Any]):
    _broadcast(_hotlist_clients, message)

def push_risk(message: Dict[str, Any]):
    _broadcast(_risk_clients, message)

#函数调用
set_push_callbacks(push_hotlist, push_risk)

#新加
@app.route("/")
def index():
    return render_template("index.html")


#最近30天风险和热度
@app.route("/api/daily_30")
def daily_30():
    end = datetime.now().date()
    start = end - timedelta(days=29)   
    out = []
    for i in range(30):
         # 计算第 i 天的日期
        d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        arc = load_daily_archive(d)
        heat_total = 0.0
        risk_total = 0.0
        for name, ev in arc.items():
            if ev.get("hot_values"):
                #-1取排序后列表的最后一个元素
                last_hot = ev["hot_values"][sorted(ev["hot_values"].keys())[-1]]
                heat_total += float(last_hot or 0.0)
            risk_total += float(ev.get("risk_score",  0.0))
        out.append({"date": d, "heat": heat_total, "risk": risk_total})
    return jsonify({"data": out})

@app.route("/api/hotlist/current")
def hotlist_current():
    js = read_json(HOTLIST_DIR / "latest.json", default=None)
    return jsonify(js or {"date": None, "hour": None, "data": []})

@app.route("/api/risk/latest")
def risk_latest():
    return jsonify(load_risk_warnings())


#待修改，是否加一个参数来寻找最近一周，最近一个月、最近半年的事件
@app.route("/api/event")
def get_event():
    name = request.args.get("name")
    if not name:
        return jsonify({"error": "name required"}), 400
    today = datetime.now().date()
    for i in range(7):
        d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        arc = load_daily_archive(d)
        if name in arc:
            return jsonify(arc[name])
    return jsonify({"error": "not found"}), 404

#也要修改为从昨天算七天吗
@app.route("/api/central_data")
def central_data():
    range_opt = request.args.get("range", "week")
    days = {"week": 7, "month": 30, "halfyear": 182}.get(range_opt, 7)
    end = datetime.now().date()
    out = []
    seen = set()
    for i in range(days):
        d = (end - timedelta(days=i)).strftime("%Y-%m-%d")
        arc = load_daily_archive(d)
        for name, ev in arc.items():
            if name in seen: continue
            seen.add(name)
            out.append({
                "name": name,
                "date": ev.get("last_seen_at", f"{d}T00:00:00")[:10],
                "领域": ev.get("llm", {}).get("topic_type") or "其他",
                "地区": ev.get("llm", {}).get("region") or "国外",
                "情绪": float(ev.get("llm", {}).get("sentiment", 0.0)),
                "风险值": float(ev.get("risk_score", 0.0))
            })
    return jsonify({"data": out})

# 调式：手动触发“当天 LLM 更新一次”，加密钥最后可保留不删除
@app.route("/api/admin/run_daily_llm", methods=["POST","GET"])
def run_daily_llm():
    # token = request.args.get("token")
    # if token != "your_admin_secret": # 这里的密钥可以自己设置
    #     return jsonify({"error": "unauthorized"}), 403
    
    daily_llm_update()
    return jsonify({
            "ok": True,
            "ran_at": datetime.now().isoformat(),
            "scheduled_time": DAILY_LLM_TIME
        }
    )

@sock.route('/ws/hotlist')
def ws_hotlist(ws):
    _hotlist_clients.add(ws)
    try:
        while True:
            _ = ws.receive()
    except Exception:
        pass
    finally:
        _hotlist_clients.discard(ws)


@sock.route('/ws/risk_warnings')
def ws_risk(ws):
    _risk_clients.add(ws)
    try:
        while True:
            _ = ws.receive()
    except Exception:
        pass
    finally:
        _risk_clients.discard(ws)

def create_app():
    start_scheduler()
    return app

#部署时修改/删除
if __name__ == "__main__":
    start_scheduler()
    app.run(host="0.0.0.0", port=8000, debug=True)
