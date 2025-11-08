
# 微博舆情监测系统 · GitHub数据源 + 每日一次 LLM
> 该版本实现：
> - 热榜 **从 GitHub 仓库**拉取小时数据（方式1）
> - 贴文 **由同学接口**提供（方式2，已标注协作点）
> - 大模型只分析 **情绪/地区/类型**（删除谣言字段）
> - **每天一次**在固定时间点（默认 `09:30`）调用 LLM 并更新风险
> - 中央可视化：稳定组标签 + 平滑过渡；连续属性为“时间”时显示自适应日期刻度

## 运行
```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/run_server.py
# 打开 http://localhost:8000
```

## 配置
- `DAILY_LLM_TIME`：每天调用 LLM 的时间（Asia/Shanghai），默认 `09:30`。例如：
  ```bash
  export DAILY_LLM_TIME="08:45"
  ```
- `OPENAI_API_KEY` / `OPENAI_MODEL`：若不配置，将使用启发式占位推断，流程仍可跑通。

## 与同学协作（务必实现这两处）
- `backend/fetchers/classmate_adapter.py#get_hourly_hotlist_from_peer`（可选）：若未来热榜也改由同学提供，优先使用此接口返回 `[{rank,name,hot}, ...]`。
- `backend/fetchers/classmate_adapter.py#fetch_posts_for_event_from_peer`（必需）：返回事件前20条贴文（时间/账号/正文/媒体/转评赞）。每天固定时刻系统会调用该接口抓取贴文并进行 LLM 标注。

## 后端行为说明
- **小时任务**：每 5 分钟检查当日未保存的 `HH.json`（GitHub），保存后更新当日归档的基础字段（`hot_values/hour_list` 等），**不触发 LLM**。
- **每日任务**：到 `DAILY_LLM_TIME` 时，对**当日出现在热榜的事件**调用同学的贴文接口 + LLM（仅情绪/地区/类型）→ 计算风险（负面/增长/敏感/涉众）→ 写入当日归档 → 生成近7天风险预警 Top5 并通过 WebSocket 推送。

## 中央可视化改动
- 按离散属性（领域/地区）使用 **Pack 气泡**，标签稳定在**父组外缘顶部**；切换属性时，使用稳定 key 与独立标签图层避免闪烁/丢失。
- 按连续属性（情绪/时间/风险值）使用 **Beeswarm**；当选择“时间”且更换“最近一周/一月/半年”时，x 轴自适应显示**日期刻度**（天/周/月），过多时自动抽稀。


