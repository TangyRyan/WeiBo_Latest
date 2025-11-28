(function(){

  // --- 新增工具函数：填充最近 10 天的空缺日期 ---
  function fillMissingDays(entries) {
    // 1. 确定基准日期 (取 entries 中最大的日期，或者今天)
    let maxDate = new Date();
    if (entries.length > 0) {
        const lastEntryDate = entries[entries.length - 1].date;
        if (lastEntryDate > maxDate) maxDate = lastEntryDate;
    }
    
    // 2. 生成最近 10 天的日期字符串集合
    const dayFormat = d3.timeFormat("%Y-%m-%d");
    const targetDates = [];
    for (let i = 0; i < 10; i++) {
        const d = d3.timeDay.offset(maxDate, -i);
        targetDates.push({ str: dayFormat(d), date: d });
    }

    // 3. 检查现有数据覆盖了哪些天
    const existingDays = new Set(entries.map(e => dayFormat(e.date)));
    const finalEntries = [...entries];

    // 4. 补全缺失的天 (插入 Dummy 数据)
    targetDates.forEach(item => {
        if (!existingDays.has(item.str)) {
            // 构造一个“占位”事件，标记为 isDummy
            const ts = Math.floor(item.date.getTime() / 1000);
            finalEntries.push({
                entryId: `dummy-${item.str}`,
                eventId: `dummy-${item.str}`,
                title: "", // 无标题
                timestamp: item.date.toISOString(),
                ts: ts,
                date: item.date,
                category: "dummy", // 特殊分类
                heat: 0,
                region: "",
                sentiment: 0,
                isDummy: true // 关键标记：这是一个假数据
            });
        }
    });

    // 5. 重新按时间排序
    return finalEntries.sort((a, b) => a.ts - b.ts);
  }

  const parseDate = d3.timeParse("%Y-%m-%d");

  const formatTick = d3.timeFormat("%m-%d");
  const formatFullDate = d3.timeFormat("%Y-%m-%d %H:%M");
  const formatDayLabel = d3.timeFormat("%Y-%m-%d");

  const API_BASE = `${location.origin}/api/health`;

  const palette = [
    "#f25f5c",
    "#f2855d",
    "#f4c95d",
    "#4ecdc4",
    "#3793e0",
    "#6e7ff3",
    "#b066ff",
    "#ff89d8",
    "#57cc99",
    "#ffa94d",
    "#70a1d7",
    "#ff6b9a",
  ];
  const HEALTH_CATEGORY_COLORS = {
    "传染病与公共卫生应急": "#f25f5c",
    "医疗服务与医患矛盾": "#f2855d",
    "食品药品安全": "#f4c95d",
    "环境与灾害关联健康问题": "#4ecdc4",
    "特殊场景与群体健康": "#3793e0",
    "健康管理与养生": "#6e7ff3",
    "医疗行业与技术动态": "#b066ff",
    "健康政策与公共服务": "#ff89d8",
    "健康观念与社会现象": "#57cc99",
  };

  const DEFAULT_TIMELINE_HOURS = 240;
  const DEFAULT_AGGREGATE_INTERVAL = "hour";
  // 每天最多显示的事件数量”为6个
  const MAX_EVENTS_PER_DAY = 6;
  // 时间轴卡片堆叠的间距与基准
  const TIMELINE_CARD_GAP = 8;
  const TIMELINE_CARD_BOTTOM_PADDING = 12;
  const TIMELINE_CARD_DEFAULT_HEIGHT = 32;
  
  const timelineState = { events: [], archiveDate: null, summary: null };
  let timelineNodes = null;
  let selectedEventId = null;
  let timelineLayout = { width: 960, dayCount: 1 };

  //存储从 /api/health/timeline 获取的原始API数据
  // fetchTimeline 函数会先检查这个变量，如果已有数据，就直接使用，避免重复发起网络请求
  let timelineCache = null;
  let timelinePromise = null;

  let timelineRangeHours = DEFAULT_TIMELINE_HOURS;

  //缓存单个事件详细数据的 Map 对象
  const detailCache = new Map();
  let milestoneChart = null;
  let milestoneRenderOptions = {};

  //获取核心时间轴数据
  function fetchTimeline(force = false){
    if (!force && timelineCache) {
      return Promise.resolve(timelineCache);
    }
    if (!force && timelinePromise) {
      return timelinePromise;
    }

    //创建一个新的 URLSearchParams 对象，这是一个用来构建 URL 查询字符串（即 ?key=value）的辅助工具。
    const params = new URLSearchParams();
    if (timelineRangeHours) {
      params.set("hours", timelineRangeHours);
    }
    const url = params.toString() ? `${API_BASE}/timeline?${params.toString()}` : `${API_BASE}/timeline`;
    
    timelinePromise = fetch(url)
       //res为HTTP响应对象
      .then(res => {
        if (!res.ok) {
          throw new Error(`health timeline response ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        console.log("[health-timeline] payload days", Array.isArray(data?.events) ? Array.from(new Set(data.events.map(item => formatTick(new Date(item.startDate || item.date || item.endDate || item.ts ? (item.ts && item.ts*1000) : Date.now()))))).sort() : "no events");
        timelineCache = data;
        return data;
      })
      .finally(() => {
        //正在进行中的请求”变量重置为 null，表示当前没有正在进行的请求
        timelinePromise = null;
      });
    return timelinePromise;
  }

  //获取并缓存单个健康事件的详细数据
  function fetchEventDetail(eventId, date){
    if (!eventId) {
      return Promise.reject(new Error("missing event id"));
    }
    // 创建一个唯一的缓存键 (key)
    const key = `${date || 'latest'}:${eventId}`;

    if (detailCache.has(key)) {
      return Promise.resolve(detailCache.get(key));
    }

    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    return fetch(`${API_BASE}/events/${encodeURIComponent(eventId)}${query}`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`event detail response ${res.status}`);
        }
        return res.json();
      })
      .then(detail => {
        detailCache.set(key, detail);
        return detail;
      });
  }

  //数据清洗和转换函数
  //这个函数是作为 renderHealthTimeline 中的备用（fallback）逻辑存在的
  // 以防 fetchTimeline API 调用失败
  function normalizeLegacyEvents(rawEvents){

    if (!Array.isArray(rawEvents) || !rawEvents.length) {
      return [];
    }
    //去除无效值
    const source = rawEvents.filter(Boolean);
    if (!source.length) return [];

    const heatSeries = source
      .map(getLegacyHeat)
      .filter(value => Number.isFinite(value));

    const min = heatSeries.length ? d3.min(heatSeries) : 0;
    const max = heatSeries.length ? d3.max(heatSeries) : min + 1;
    const domain = min === max ? [min, min + 1] : [min, max];

    // 创建一个 D3 线性比例尺
    const riskScale = d3.scaleLinear().domain(domain).range([20, 85]);
    // 遍历清洗过的 source 数组，对每一个 event 对象执行转换，并返回一个新的、格式统一的对象数组。
    return source.map((event, idx) => {
      const normalizedDate = normalizeDate(event);
      const hot = Math.round(getLegacyHeat(event) || 0);
      const risk = getRiskValueLegacy(event, hot, riskScale);
      const category = event.category || event.health_major || event.topic || event.major || event["类别"] || event["分类"] || "其他";
      const summary = event.summary || event.description || event.details || event["事件摘要"] || event.overview || event.newsTitle || "";

      return {
        id: event.event_id || event.id || event.ID || event.slug || event.name || `health-${idx}`,
        title: event.title || event.name || event.newsTitle || event.topic || `健康事件 ${idx + 1}`,
        summary: summary || "暂无摘要",
        date: normalizedDate,
        startDate: normalizedDate,
        endDate: normalizedDate,
        dateText: formatTick(normalizedDate),
        category,
        risk,
        hot,
        riskBand: getRiskBand(risk),
        region: event.region || event.area || event["地区"] || "未知",
        sentiment: Number(event.sentiment ?? event["情绪"] ?? 0) || 0,
        raw: event,
      };
    }).sort((a, b) => a.date - b.date);
  }

  //数据转换函数
  // 接收从后端 /api/health/timeline API 传来的原始事件数据（payload）
  // 并将其“加工”成前端图表可以直接使用和显示的、格式统一且包含额外计算值的数组。
  function hydrateApiEvents(payload){

    const events = Array.isArray(payload?.events) ? payload.events : [];
    if (!events.length) return [];

    //只包含热度值的数组
    const heatValues = events.map(getHeatValue);
    //热度值的范围（最小值和最大值）
    const extent = d3.extent(heatValues);

    const min = extent[0] ?? 0;
    const max = extent[1] ?? (min + 1);
    const domain = min === max ? [min - 1, max + 1] : extent;

    //热度映射到风险值
    const riskScale = d3.scaleLinear().domain(domain).range([20, 85]);

    return events.map((event, idx) => {
      const endTs = event.end_ts || event.start_ts || Math.floor(Date.now() / 1000);
      const startTs = event.start_ts || event.end_ts || endTs;
      const endDate = new Date(endTs * 1000);
      const startDate = new Date(startTs * 1000);
      const date = endDate || startDate;
      const hot = Math.round(getHeatValue(event));
      const baseRisk = riskScale(hot || min);
      const sentimentPenalty = event.sentiment < -0.15 ? Math.abs(event.sentiment) * 20 : 0;
      const risk = Math.max(10, Math.min(95, baseRisk + sentimentPenalty));
      return {
        id: event.event_id || `health-${idx}`,
        title: event.title || `健康事件 ${idx + 1}`,
        summary: event.summary || event.title || "暂无摘要",
        category: event.category || event.health_major || "其他",
        date,
        startDate,
        endDate,
        dateText: formatTick(date),
        risk,
        hot,
        riskBand: getRiskBand(risk),
        region: event.region || "未知",
        sentiment: event.sentiment || 0,
        raw: event,
      };
    }).sort((a, b) => a.date - b.date);
  }


  // 接收一个已经按时间排序的事件列表
  // 并将它们按天分组，同时对每天的事件数量进行限制（截取最热的 MAX_EVENTS_PER_DAY 个）
  // 最后补全空缺的日期，返回一个新数组
  function groupEventsByDay(events){
    if (!Array.isArray(events) || !events.length) return [];
    const dayKey = d3.timeFormat("%Y-%m-%d");
    const buckets = new Map();
    events.forEach(event => {
      const baseDate = d3.timeDay.floor(event.startDate || event.date);
      const key = dayKey(baseDate);
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          date: baseDate,
          label: formatTick(baseDate),
          events: [],
          overflow: 0,
        });
      }
      buckets.get(key).events.push(event);
    });

    if (!buckets.size) return [];

    const ordered = Array.from(buckets.values()).sort((a, b) => a.date - b.date);

    const minDate = ordered[0].date;

    const maxDate = ordered[ordered.length - 1].date;

    const allDays = d3.timeDay.range(minDate, d3.timeDay.offset(maxDate, 1));

    return allDays.map(day => {
      const key = dayKey(day);
      const bucket = buckets.get(key);
      if (!bucket) {
        return {
          key,
          date: day,
          label: formatTick(day),
          events: [],
          overflow: 0,
        };
      }

      const sorted = bucket.events.slice().sort((a, b) => b.hot - a.hot);

      const overflow = Math.max(0, sorted.length - MAX_EVENTS_PER_DAY);

      return {
        key,
        date: bucket.date,
        label: bucket.label,
        events: sorted.slice(0, MAX_EVENTS_PER_DAY),
        overflow,
      };
    });
  }


  function getHeatValue(event){

    if (!event) return 0;

    if (event.heat_peak) return event.heat_peak;

    if (Array.isArray(event.points) && event.points.length) {

      return d3.max(event.points, d => d.heat || 0) || 0;

    }

    return 0;

  }

// 用于从一个可能格式不统一的“旧版”事件对象（event）中尽力提取出“热度”值
  function getLegacyHeat(event){

    if (!event) return 0;

    const direct = event.hot ?? event.heat ?? event.heat_peak ?? event["热度"];

    if (direct != null && direct !== '') {

      const value = Number(direct);

      if (Number.isFinite(value)) return value;

    }

    if (event.hot_values && typeof event.hot_values === 'object') {

      const entries = Object.entries(event.hot_values);

      if (entries.length) {

        const latest = entries.sort((a, b) => (a[0] > b[0] ? 1 : -1))[entries.length - 1][1];

        const parsed = Number(latest);

        if (Number.isFinite(parsed)) return parsed;

      }

    }

    if (Array.isArray(event.points) && event.points.length) {

      const peak = d3.max(event.points, d => Number(d.heat) || 0) || 0;

      if (peak) return peak;

    }

    return 0;

  }


  function normalizeDate(event){

    const raw = event.date || event.last_seen_at || event.timestamp || event.publishTime || event["时间"] || event["date"];

    if (raw) {

      const safe = String(raw).replace(/\./g, "-").replace(/\//g, "-");

      const parsed = parseDate(safe);

      if (parsed) return parsed;

    }

    const ts = event.start_ts || event.end_ts;

    if (ts) {

      const date = new Date(Number(ts) * 1000);

      if (!Number.isNaN(date.getTime())) {

        return date;

      }

    }

    return d3.timeDay.offset(new Date(), -Math.floor(Math.random() * 10));

  }


  function getRiskValueLegacy(event, hot, riskScale){

    if (event["风险"] != null) return +event["风险"];

    if (event["风险值"] != null) return +event["风险值"];

    if (event.risk != null) return +event.risk;

    if (typeof riskScale === 'function' && Number.isFinite(hot)) {

      return Math.max(10, Math.min(95, riskScale(hot)));

    }

    return 35;

  }


  function getRiskBand(value){

    if (value >= 50) return "high";

    if (value >= 20) return "medium";

    return "low";

  }

// 在“健康医疗”面板的左上角（#health-legend 区域）动态创建图例。
// --- 修改开始 ---
// --- 修改开始：修正分类和颜色绑定的 renderLegend ---
function renderLegend() { 
  const legend = d3.select("#health-legend");
  if (legend.empty()) return;

  // 1. 依据《识别指南》严格定义九大类（保持固定顺序）
  const majors = [
    "传染病与公共卫生应急",
    "医疗服务与医患矛盾",
    "食品药品安全",
    "环境与灾害关联健康问题",
    "特殊场景与群体健康",
    "健康管理与养生",
    "医疗行业与技术动态",
    "健康政策与公共服务",
    "健康观念与社会现象"
  ];

  // 2. 建立颜色映射（直接读取文件头部定义的 HEALTH_CATEGORY_COLORS）
  const colorFunc = d => HEALTH_CATEGORY_COLORS[d] || "#999";

  // 3. 绑定数据
  const items = legend.selectAll("div.legend-item").data(majors, d => d);

  // 清理旧元素
  items.exit().remove();

  // 创建新元素
  const enter = items.enter().append("div").attr("class", "legend-item")
    .style("display", "inline-flex")
    .style("align-items", "center")
    .style("gap", "6px")
    .style("margin-right", "12px"); // 增加间距优化排版

  // 图例色点
  enter.append("span").attr("class", "legend-color")
    .style("display", "inline-block")
    .style("width", "10px")
    .style("height", "10px")
    .style("border-radius", "50%") // 圆形色点
    .style("flex-shrink", "0");

  // 图例文字
  enter.append("span").attr("class", "legend-label")
    .style("font-size", "12px")
    .style("color", "#333")
    .style("white-space", "nowrap");

  const merged = enter.merge(items);

  // 4. 应用颜色和文本
  merged.select(".legend-color").style("background", d => colorFunc(d));
  merged.select(".legend-label").text(d => d);
}


function ensureTooltip(){

    return d3.select("body").selectAll(".health-timeline-tooltip").data([null]).join("div")

      .attr("class", "health-timeline-tooltip")

      .style("position", "absolute")

      .style("pointer-events", "none")

      .style("padding", "10px 12px")

      .style("border-radius", "8px")

      .style("font-size", "12px")

      .style("line-height", "1.4")

      .style("color", "#e8f1ff")

      .style("background", "rgba(7,20,45,0.92)")

      .style("border", "1px solid rgba(255,255,255,0.08)")

      .style("box-shadow", "0 8px 24px rgba(5,10,30,0.45)")

      .style("opacity", 0);

  }


// 显示工具提示，展示事件的详细信息
  function showTooltip(tooltip, event, entry){

    if (!entry) return;

    tooltip

      .style("opacity", 1)

      .style("left", `${event.pageX + 12}px`)

      .style("top", `${event.pageY - 20}px`)

      .html(`

        <div style="font-weight:600;margin-bottom:4px;font-size:13px;">${entry.title}</div>

        <div style="opacity:0.8;">时间：${formatFullDate(entry.date)}</div>

        <div style="opacity:0.8;">所属类别：${entry.category || '未知'}</div>

        <div style="opacity:0.8;">热度：${Math.round(entry.heat || 0)}</div>

        <div style="opacity:0.8;">地区：${entry.region || '未知'}</div>

      `);

  }

// 隐藏工具提示
  function hideTooltip(tooltip){
    tooltip.style("opacity", 0);
  }


  const categoryCache = new Map();

  function colorForCategory(category, index = 0){

    if (category && categoryCache.has(category)) {

      return categoryCache.get(category);

    }

    const predefined = category ? HEALTH_CATEGORY_COLORS[category] : null;

    const fallbackIndex = (categoryCache.size + index) % palette.length;

    const color = predefined || palette[fallbackIndex];

    if (category) {

      categoryCache.set(category, color);

    }

    return color;

  }


  //**“健康医疗”面板（#health-panel）中时间轴的“主渲染函数”**。
  function renderTimeline(events, options = {}){

    const container = d3.select("#health-timeline");
    if (container.empty()) {
      console.warn("[health-timeline] missing #health-timeline");
      return;
    }

    const chart = ensureMilestonesChart();
    
    if (!chart) {
      showTimelineEmpty("暂无健康事件可展示");
      return;
    }

    let entries = buildTimelineEntries(events);

    entries = fillMissingDays(entries);

    milestoneRenderOptions = options || {};

    if (options.selectedId) {

      selectedEventId = options.selectedId;

    }

    if (!entries.length) {
      showTimelineEmpty("暂无健康事件可展示");
      timelineNodes = null;
      return;
    }


    d3.select("#health-timeline-chart").selectAll(".health-empty").remove();

    ensureTimelineWidth(entries);

    chart.render(entries);
    renderTimelineList(entries);
    updateSelectedList(selectedEventId);

  }



  // backend/static/js/timeline.js -> ensureMilestonesChart

  function ensureMilestonesChart(){
    if (milestoneChart) return milestoneChart;
    if (typeof milestones !== "function") {
      console.error("[health-timeline] d3-milestones runtime is missing");
      return null;
    }
    const chart = milestones("#health-timeline-chart")
      .mapping({
        timestamp: "timestamp",
        text: "title",
        id: "entryId",
      })
      // 【修改 1】改为按“天”聚合，这样同一天的事件会堆叠
      .aggregateBy("day") 
      .optimize(true)
      .distribution("top-bottom")
      // 【修改 2】开启标签显示！这是关键
      .useLabels(true) 
      .renderCallback(() => {
        decorateMilestones();
      });
    milestoneChart = chart;
    return chart;
  }


  //将后端返回的“事件列表”转换为前端时间轴组件所能识别的“时间节点列表”格式
  // backend/static/js/timeline.js -> buildTimelineEntries

function buildTimelineEntries(events = []){
    if (!Array.isArray(events) || !events.length) {
      return [];
    }
    const entries = [];

    events.forEach(event => {
      if (!event) return;
      
      // ... (这部分提取 points 的逻辑保持不变) ...
      // 关键是下面的 push 逻辑
      
      const points = getEventPoints(event);
      if (points.length) {
        points.forEach(point => {
            // ... 获取 ts, date 等 ...
            const ts = Number(point?.ts || point?.timestamp || 0);
            const date = getPointDate(ts, event);
            const seconds = Math.floor(date.getTime() / 1000);
            
            entries.push({
                // ... ID 等保持不变 ...
                entryId: `${event.id || event.event_id || "health"}-${seconds}-${point?.rank ?? "p"}`,
                eventId: event.id,
                title: event.title,
                // 【关键恢复】：直接使用真实日期！不要再被覆盖了
                timestamp: date.toISOString(), 
                ts: seconds,
                date: date,
                category: event.category,
                // ... 其他字段保持不变 ...
                heat: Number(point?.heat ?? event.hot ?? 0),
                region: event.region || "未知",
                sentiment: Number(event.sentiment || 0),
                originalEvent: event,
            });
        });
        return;
      }

      // Fallback 逻辑
      const fallbackDate = event.endDate || event.startDate || event.date || new Date();
      const seconds = Math.floor(fallbackDate.getTime() / 1000);
      entries.push({
         // ... ID 等保持不变 ...
         entryId: `${event.id || "health"}-${seconds}`,
         eventId: event.id,
         title: event.title,
         // 【关键恢复】：直接使用真实日期！
         timestamp: fallbackDate.toISOString(),
         ts: seconds,
         date: fallbackDate,
         category: event.category,
         // ... 其他字段保持不变 ...
         heat: Number(event.hot || 0),
         region: event.region || "未知",
         sentiment: Number(event.sentiment || 0),
         originalEvent: event,
      });
    });

    // 【关键】：删除之前最后添加的那段 "伪造时间戳" (forEach index...) 的代码
    // 只保留排序
    return entries.sort((a, b) => a.ts - b.ts);
}



  function getEventPoints(event){

    if (!event) return [];

    if (Array.isArray(event.raw?.points) && event.raw.points.length) {

      return event.raw.points;

    }

    if (Array.isArray(event.points) && event.points.length) {

      return event.points;

    }

    return [];

  }



  function getPointDate(ts, event){

    if (ts) {

      return new Date(ts * 1000);

    }

    if (event?.date instanceof Date) {

      return event.date;

    }

    if (event?.endDate instanceof Date) {

      return event.endDate;

    }

    if (event?.startDate instanceof Date) {

      return event.startDate;

    }

    return new Date();

  }


 //美化
  // backend/static/js/timeline.js -> decorateMilestones

  function decorateMilestones(){
    const container = d3.select("#health-timeline-chart");
    if (container.empty()) return;
    
    // 工具提示逻辑保持不变...
    const tooltip = ensureTooltip(); 
    const axisNode = container.select(".milestones__horizontal_line").node();
    const containerNode = container.node();
    const axisY = (() => {
      if (axisNode && containerNode) {
        const axisRect = axisNode.getBoundingClientRect();
        const containerRect = containerNode.getBoundingClientRect();
        return axisRect.top - containerRect.top + (axisRect.height || 0) / 2;
      }
      return (containerNode?.clientHeight || 180) - TIMELINE_CARD_BOTTOM_PADDING;
    })();

    /* milestones-date-label-cleanup */
    container.selectAll('.milestones-date-label').remove();
    timelineNodes = container.selectAll(".milestones__group");

    timelineNodes.each(function(d, index){
      
      const group = d3.select(this);
      
      
      const entries = d.values || [];
      
      const isDummyDay = entries.length > 0 && entries.every(e => e.isDummy);

      if (isDummyDay) {
          // 隐藏轴上的圆点
          group.select(".milestones__group__bullet").style("opacity", 0);
          // 隐藏轴上的文字（事件标题，Dummy 是空字符串，但也可能占位）
          group.selectAll(".milestones__group__label").style("display", "none");
          
          // 注意：d3-milestones 的日期标签（Category Label）是独立渲染的，
          // 只要有数据组，日期就会显示，所以不需要额外操作就能看到日期。
          return; // 结束对该节点的处理
      }
      const firstEntry = entries[0];
      const mainColor = colorForCategory(firstEntry?.category || null, index);
      
      group.select(".milestones__group__bullet")
        .style("background-color", "#fff")
        .style("border-color", mainColor)
        .style("border-width", "2px");

      const labels = group.selectAll(".milestones__group__label-horizontal, .milestones__group__label-vertical");
      const labelNodes = labels.nodes();
      const labelCount = labelNodes.length;
      const measuredHeights = labelNodes
        .map(node => (node?.getBoundingClientRect?.().height || 0))
        .filter(h => h > 0);
      const cardHeight = measuredHeights.length ? Math.max(...measuredHeights) : TIMELINE_CARD_DEFAULT_HEIGHT;
      const stackHeight = labelCount
        ? (labelCount * cardHeight) + (Math.max(0, labelCount - 1) * TIMELINE_CARD_GAP)
        : 0;

      // 让圆点贴在轴线上，卡片沿竖线向上堆叠
      group.style("top", `${axisY}px`);

      // 拉伸竖线到卡片顶部
      const verticalLine = group.select(".milestones__vertical_line");
      if (!verticalLine.empty()) {
        const lineHeight = stackHeight + TIMELINE_CARD_BOTTOM_PADDING;
        verticalLine
          .style("height", `${lineHeight}px`)
          .style("top", `-${lineHeight}px`);
      }

      // 处理文字标签的颜色与堆叠偏移
      labels.each(function(labelData, labelIndex) {
         // labelData 对应 entries 中的一项
         const category = labelData.category; 
         const color = colorForCategory(category);
         const offset = TIMELINE_CARD_BOTTOM_PADDING + cardHeight + labelIndex * (cardHeight + TIMELINE_CARD_GAP);
         
         d3.select(this)
           .style("color", color)  // 设置文字颜色
           .style("display", "block") // 确保换行
           .style("margin-bottom", "4px")
           .style("position", "absolute")
           .style("bottom", "auto")
           .style("top", `${-offset}px`)
           .style("transform", "translateY(0)");
             
         // 重新绑定点击事件到文字上
         d3.select(this).on("click", (evt) => {
             evt.stopPropagation();
             selectedEventId = labelData.eventId;
             if (typeof milestoneRenderOptions.onSelect === "function") {
                 milestoneRenderOptions.onSelect(labelData.originalEvent);
             }
         });
         
         // 绑定 Tooltip 到文字上
         d3.select(this)
           .on("mouseenter", (event) => showTooltip(tooltip, event, labelData))
           .on("mouseleave", () => hideTooltip(tooltip));
      });
    });

    scrollTimelineToRight();
  }



  function getGroupRepresentativeEntry(groupData){

    if (!groupData || !Array.isArray(groupData.values) || !groupData.values.length) {

      return null;

    }

    return groupData.values.reduce((latest, candidate) => {

      if (!latest) return candidate;

      return (candidate.ts || 0) >= (latest.ts || 0) ? candidate : latest;

    }, null);

  }



  function groupContainsEvent(groupData, eventId){

    if (!groupData || !eventId) return false;

    return Array.isArray(groupData.values) && groupData.values.some(entry => entry.eventId === eventId);

  }



  function scrollTimelineToRight(){

    const scroller = document.getElementById("health-timeline-scroller");

    if (!scroller) return;

    scroller.scrollLeft = scroller.scrollWidth;

  }



function ensureTimelineWidth(entries) {
    if (!Array.isArray(entries) || !entries.length) return;

    const uniqueDays = Array.from(
      new Set(entries.map(entry => formatDayLabel(entry.date)))
    );

    const host = document.getElementById("health-timeline");
    const hostWidth = host ? host.clientWidth : 960;
    const dayCount = Math.max(uniqueDays.length, 1);
    const widthPerDay = 220;
    const baseWidth = Math.max(960, (dayCount * widthPerDay) + 200);
    const finalWidth = Math.max(hostWidth, baseWidth);

    const chart = document.getElementById("health-timeline-chart");
    if (chart) {
      chart.style.width = `${finalWidth}px`;
    }

    const list = document.getElementById("health-timeline-list");
    if (list) {
      list.style.width = `${finalWidth}px`;
    }

    timelineLayout = { width: finalWidth, dayCount };
}


  


// --- 修改开始：renderTimelineList 函数内部 ---

// --- backend/static/js/timeline.js -> renderTimelineList 函数 ---

function renderTimelineList(entries = []) {
  const container = d3.select("#health-timeline-list");
  if (container.empty()) return;

  // 1. 确保容器宽度 (保持滚动条)
  if (!container.style("width")) {
      container.style("width", `${timelineLayout.width}px`);
  }

  // 2. 按天分组
  const groupedByDay = d3.groups(entries, entry => formatDayLabel(entry.date))
    .sort((a, b) => new Date(a[0]) - new Date(b[0]));

  // 3. 绑定列数据 (列必须存在，用于占位撑开宽度)
  const columns = container.selectAll(".timeline-day-column").data(groupedByDay, d => d[0]);
  columns.exit().remove();

  const columnsEnter = columns.enter().append("div").attr("class", "timeline-day-column");
  columnsEnter.append("div").attr("class", "timeline-day-events");
  
  const mergedColumns = columnsEnter.merge(columns);
  
  // 设置列宽
  const columnWidth = timelineLayout.dayCount ? (timelineLayout.width / timelineLayout.dayCount) : 220;
  mergedColumns.style("width", `${columnWidth}px`);
  
  // 4. 处理每一列的内容
  mergedColumns.each(function([day, events], columnIndex) {
    const column = d3.select(this);
    const eventsContainer = column.select(".timeline-day-events");
    
    // === 关键修改 1：过滤掉 Dummy 数据 ===
    // 只有非 Dummy 的数据才会被渲染成卡片
    const realEvents = events.filter(e => !e.isDummy);
    
    // === 关键修改 2：根据是否有真实事件，控制列的背景样式 ===
    if (realEvents.length === 0) {
        // 如果这一天全是假数据（空闲日），把背景设为透明，阴影去掉
        // 这样看起来就是一片空白，但宽度还在
        column
            .style("background", "transparent")
            .style("box-shadow", "none");
    } else {
        // 如果有真实事件，恢复原来的样式
        column
            .style("background", "#f2f2ff") // 恢复 CSS 中的背景色
            .style("box-shadow", "inset 0 0 0 1px rgba(74, 85, 104, 0.08)");
    }

    // 排序并截取前 N 个
    const sortedEvents = realEvents.slice().sort((a, b) => a.ts - b.ts).slice(0, MAX_EVENTS_PER_DAY);
    
    // 重置高度
    column.style("height", "auto");

    // 绑定数据 (只绑定 realEvents)
    const items = eventsContainer.selectAll(".timeline-list-item").data(sortedEvents, entry => entry.entryId);
    
    // 移除多余的元素 (关键：如果是空数组，这里会移除之前的占位符)
    items.exit().remove();

    // 创建新元素
    const itemsEnter = items.enter().append("div")
      .attr("class", "timeline-list-item")
      .on("click", (_, entry) => {
        if (!entry || !entry.originalEvent) return;
        selectedEventId = entry.eventId;
        handleEventSelect(entry.originalEvent);
      });

    itemsEnter.append("div").attr("class", "timeline-list-dot");
    const content = itemsEnter.append("div").attr("class", "timeline-list-content");
    content.append("div").attr("class", "timeline-list-title");

    // === 颜色处理逻辑 (保留之前的修正) ===
    const mergedItems = itemsEnter.merge(items);

    const getSafeColor = (d, index) => {
        let cat = d.category || d.raw?.health_major || "其他";
        cat = String(cat).trim();
        if (HEALTH_CATEGORY_COLORS[cat]) return HEALTH_CATEGORY_COLORS[cat];
        return colorForCategory(cat, index);
    };

    mergedItems.select(".timeline-list-title")
      .text(d => d.title || "事件")
      .style("color", (d, i) => getSafeColor(d, columnIndex + i));

    mergedItems.each(function(d, entryIndex) {
      const color = getSafeColor(d, columnIndex + entryIndex);
      d3.select(this).select(".timeline-list-dot")
        .style("background-color", color)
        .style("border-color", color);
    });
  });
  
  updateSelectedList();
}

  function updateSelectedList(nextId = selectedEventId){
    const container = d3.select("#health-timeline-list");
    if (container.empty()) return;

    container.selectAll(".timeline-list-item")
      .classed("is-selected", d => d.eventId === nextId);

    if (!nextId) return;

    const targetNode = container.selectAll(".timeline-list-item").filter(d => d.eventId === nextId).node();

    if (targetNode && typeof targetNode.scrollIntoView === "function") {
      targetNode.scrollIntoView({ block: "nearest" });
    }
  }




  function updateSelectedNode(nextId = selectedEventId){

    if (!timelineNodes) return;

    timelineNodes.each(function(d, index){

      const isSelected = groupContainsEvent(d, nextId);

      const entry = getGroupRepresentativeEntry(d);

      const color = colorForCategory(entry?.category || null, index);

      d3.select(this).classed("is-selected", isSelected);

      d3.select(this).select(".milestones__group__bullet")

        .style("border-width", isSelected ? "3px" : "2px")

        .style("box-shadow", isSelected

          ? `0 0 0 5px ${color}3b, 0 4px 12px rgba(15,37,107,0.35)`

          : `0 2px 8px rgba(15,37,107,0.18), 0 0 0 4px ${color}2a`);

    });

    updateSelectedList(nextId);

  }



  function updateSummaryLabels(payload, events){

    const countBox = d3.select("#health-count");

    const updated = d3.select("#health-updated");

    if (!countBox.empty()) {

      let realEvents = [];
      if (Array.isArray(events)) {
          realEvents = events.filter(e => !e.isDummy);
      }

      const total = realEvents.length;
      // 计算真实的分类数量 (去重)
      const uniqueCategories = new Set(realEvents.map(e => e.category).filter(Boolean));
      const majorCount = uniqueCategories.size;

      countBox.text(total ? `热搜事件：${total} 条 | 覆盖 ${majorCount} 类` : "暂无健康事件");
    }

    if (!updated.empty()) {
      updated.text(payload?.updated_at ? `更新时间：${payload.updated_at.replace('T',' ').split('+')[0]}` : "");
    }

  }



  function showTimelineEmpty(message){

    const chart = d3.select("#health-timeline-chart");

    chart.selectAll("*").remove();

    chart.append("div")

      .attr("class", "health-empty")

      .style("min-height", "220px")

      .text(message || "暂无健康事件可展示");

  }



  function showEmptyState(selector, text){

    const container = d3.select(selector);

    if (container.empty()) return;

    container.selectAll("*").remove();

    container.append("div")

      .attr("class", "health-empty")

      .text(text || "暂无可用数据");

  }



  function describeSentiment(value){

    if (value >= 0.45) return "积极";

    if (value >= 0.15) return "偏积极";

    if (value <= -0.45) return "强烈消极";

    if (value <= -0.15) return "偏消极";

    return "中性";

  }


 
  function handleEventSelect(eventMeta){
    if (!eventMeta) return;
    selectedEventId = eventMeta.id;
    updateDetailSkeleton(eventMeta);
    updateSelectedNode();

    // const archiveDate = timelineState.archiveDate || (eventMeta.raw?.date) || (eventMeta.date ? d3.timeFormat("%Y-%m-%d")(eventMeta.date) : null);

    const rawArchive = (eventMeta.date ? d3.timeFormat("%Y-%m-%d")(eventMeta.date) : null) || timelineState.archiveDate || (eventMeta.raw?.date);
    const archiveDate = rawArchive ? rawArchive.split("T")[0] : null;
    const detailEventId = eventMeta.raw?.event_id || eventMeta.eventId || eventMeta.id;
    
    fetchEventDetail(detailEventId, archiveDate)
      .then(detail => updateHealthDetails(detail))
      .catch(err => {
        console.warn("[health-detail] failed to load", err);
        const summary = d3.select("#health-detail-summary");
        if (!summary.empty()) {
          summary.text("健康详情加载失败，请稍后再试");
        }
      });
  }



  function updateDetailSkeleton(eventMeta){

    d3.select("#health-detail-title").text(eventMeta.title || "请选择事件");

    d3.select("#health-detail-region").text(`${eventMeta.region || '未知'} | ${eventMeta.category || '其他'}`);

    d3.select("#health-detail-summary").text(eventMeta.summary || "暂无摘要信息");

    showEmptyState("#health-tags-graph", "暂未生成标签共现网络");

    showEmptyState("#health-wordcloud-chart", "暂无词云数据");

    showEmptyState("#health-emotions-chart", "暂无情绪数据");

    d3.select("#health-wordcloud-meta").text("--");

    d3.select("#health-emotion-meta").text("--");

    d3.select("#health-posts").html('<div class="health-empty">暂无推荐内容</div>');

  }



  function updateHealthDetails(detail){

    if (!detail) return;

    d3.select("#health-detail-title").text(detail.title || "事件详情");

    d3.select("#health-detail-region").text(`${detail.region || '未知'} | ${detail.category || '其他'}`);

    d3.select("#health-detail-summary").text(detail.summary || detail.title || "暂无摘要");



    renderTagGraph(detail.tag_graph);

    renderWordCloudSection(detail.wordcloud);

    renderEmotionSection(detail.emotions, detail.sentiment);

    renderPosts(detail.sample_posts);

  }



  function renderTagGraph(graph){

    if (typeof renderAuthorsForce === "function" && graph && graph.nodes && graph.nodes.length) {

      renderAuthorsForce("#health-tags-graph", graph);

    } else {

      showEmptyState("#health-tags-graph", graph && graph.nodes && graph.nodes.length ? "标签图渲染组件缺失" : "当前无标签数据");

    }

  }



  function renderWordCloudSection(words){

    const meta = d3.select("#health-wordcloud-meta");

    if (!Array.isArray(words) || !words.length) {

      showEmptyState("#health-wordcloud-chart", "暂无词云数据");

      meta.text("0 个关键词");

      return;

    }

    if (typeof wordCloud === "function") {

      const count = wordCloud("#health-wordcloud-chart", words, {
        minWeight: 2,
        topN: 60,
        padding: 3,
      });
      meta.text(`${count} 个关键词`);
      return;

    }

    showEmptyState("#health-wordcloud-chart", "wordCloud 组件未加载");
    meta.text("0 个关键词");

  }



  function renderEmotionSection(emotions, sentiment){

    const meta = d3.select("#health-emotion-meta");

    if (!Array.isArray(emotions) || !emotions.length) {

      showEmptyState("#health-emotions-chart", "暂无情绪数据");

      meta.text("事件情绪： --");

      return;

    }

    if (typeof plutchik === "function") {

      plutchik("#health-emotions-chart", emotions);

    } else {

      showEmptyState("#health-emotions-chart", "plutchik 组件未加载");

    }

    meta.text(`事件情绪：${describeSentiment(sentiment ?? 0)}`);

  }



  function renderPosts(posts){

    const container = d3.select("#health-posts");

    if (container.empty()) return;

    container.selectAll("*").remove();

    if (!Array.isArray(posts) || !posts.length) {

      container.append("div").attr("class", "health-empty").text("暂无推荐信息");

      return;

    }

    posts.slice(0, 4).forEach(post => {

      const block = container.append("div").attr("class", "post");

      block.append("div").attr("class", "meta")

        .text(`${post.account_name || '未知账号'} · ${formatPostTime(post.published_at)}`);

      block.append("p").attr("class", "excerpt")

        .text(post.content_text || "");

    });

  }



  function formatPostTime(raw){

    if (!raw) return "";

    const date = new Date(raw);

    if (!Number.isNaN(date.getTime())) {

      const month = String(date.getMonth() + 1).padStart(2, '0');

      const day = String(date.getDate()).padStart(2, '0');

      const hour = String(date.getHours()).padStart(2, '0');

      const minute = String(date.getMinutes()).padStart(2, '0');

      return `${month}-${day} ${hour}:${minute}`;

    }

    return String(raw).split('T')[0] || raw;

  }



  function renderHealthTimeline(rawEvents){

    const fallbackEvents = normalizeLegacyEvents(rawEvents);

    const container = d3.select("#health-timeline");

    container.classed("loading", true);

    return fetchTimeline()

      .then(payload => {
        const events = hydrateApiEvents(payload);

        timelineState.events = events.length ? events : fallbackEvents;
        timelineState.archiveDate = payload?.date || null;
        timelineState.summary = payload?.summary || null;

        container.classed("loading", false);

        if (!timelineState.events.length) {
          showTimelineEmpty("暂无健康事件可展示");
          updateSummaryLabels(payload, 0);
          return;
        }

        // === 关键修改：颜色分配逻辑 ===
        categoryCache.clear();
        timelineState.events.forEach(event => {
          const cat = event.category;
          if (!categoryCache.has(cat)) {
            // 优先查表 HEALTH_CATEGORY_COLORS，查不到才用 palette 轮询
            const color = HEALTH_CATEGORY_COLORS[cat] || palette[categoryCache.size % palette.length];
            categoryCache.set(cat, color);
          }
        });

        // === 关键修改：调用静态图例 ===
        // 不再传递动态参数，直接渲染固定的九大类图例
        renderLegend();

        updateSummaryLabels(payload, timelineState.events);

        renderTimeline(timelineState.events, { onSelect: handleEventSelect, selectedId: selectedEventId });

        if (!selectedEventId && timelineState.events.length) {

          handleEventSelect(timelineState.events[timelineState.events.length - 1]);

        } else if (selectedEventId) {

          updateSelectedNode();

        }

      })

      .catch(err => {

        console.error("[health-timeline] api failed", err);

        container.classed("loading", false);

        if (fallbackEvents.length) {

          timelineState.events = fallbackEvents;

          timelineState.archiveDate = null;

          categoryCache.clear();

          fallbackEvents.forEach(event => {

            if (!categoryCache.has(event.category)) {

              const color = palette[categoryCache.size % palette.length];

              categoryCache.set(event.category, color);

            }

          });

          const categories = Array.from(categoryCache.keys());

          const legendScale = d3.scaleOrdinal().domain(categories).range(Array.from(categoryCache.values()));

          renderLegend(categories, legendScale);

          updateSummaryLabels(null, fallbackEvents);

          renderTimeline(fallbackEvents, { onSelect: handleEventSelect, selectedId: selectedEventId });

          handleEventSelect(fallbackEvents[fallbackEvents.length - 1]);

        } else {

          showTimelineEmpty("暂无健康事件可展示");

          updateSummaryLabels(null, 0);

        }

      });

  }

  window.renderHealthTimeline = renderHealthTimeline;

})();
