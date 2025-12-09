
# -*- coding: utf-8 -*-
import os
import sys
# 获取当前脚本（run_server.py）的所在目录
current_script_dir = os.path.dirname(os.path.abspath(__file__))
# 项目根目录是脚本目录的上一级（因为 scripts 文件夹通常在项目根目录下）
project_root = os.path.abspath(os.path.join(current_script_dir, ".."))
# 将项目根目录添加到 Python 搜索路径
sys.path.append(project_root)
from backend.app import create_app
from backend.scheduler import check_current_day_hours
app = create_app(); check_current_day_hours()  # 启动即跑一次，夹具会产出 hotlist/archive/risk_warnings
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8766"))
    app.run(host="0.0.0.0", port=port, debug=True)
