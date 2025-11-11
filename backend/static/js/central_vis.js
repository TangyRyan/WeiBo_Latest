(function(){
  // 定义字段
  const discreteFields = ["领域", "地区"];
  const continuousFields = ["情绪", "时间", "风险值"];
  const allFields = discreteFields.concat(continuousFields);

  // 选择容器并清空
  const container = d3.select("#central-vis");
  container.select("svg").remove();

  // 响应式变量
  let currentWidth, currentHeight;

  // 创建 SVG
  const svg = container.append("svg").style("display","block");

  // 填充下拉选项
  const attrSel = d3.select("#central-attribute");
  const colorSel = d3.select("#central-colorby");

  attrSel.selectAll("option").data(allFields).enter().append("option").attr("value", d=>d).text(d=>d);
  colorSel.selectAll("option").data(allFields).enter().append("option").attr("value", d=>d).text(d=>d);

  attrSel.property("value", "领域");
  colorSel.property("value", "风险值");

  // 颜色比例尺
  const color = d3.scaleOrdinal(d3.schemeTableau10);
  const colorCont = d3.scaleSequential(d3.interpolateTurbo).domain([0,100]);

  // tooltip（通用容器）
  const tooltip = d3.select("body").append("div").attr("class", "tooltip")
    .style("position","absolute")
    .style("pointer-events","none")
    .style("background","transparent")
    .style("padding","0px")
    .style("border-radius","6px")
    .style("font-size","12px")
    .style("color","#e8e8e8")
    .style("visibility","hidden");

  // 动画时长（可调）
  const transitionDuration = 750;

  // 聚焦
  let focus = null;

  // 根组
  const rootGroup = svg.append("g");
  const nodePositionCache = new Map();

  // 颜色获取函数
 function getColor(input, colorby){
  // 如果没有传入有效对象，给个安全默认
  if (!input) {
    return continuousFields.includes(colorby) ? colorCont(0) : color("未知");
  }

  let row = input;
  if (row && typeof row === "object") {
    // 如果 row.data.data 存在，优先使用它（最深的原始事件）
    if (row.data && row.data.data && typeof row.data.data === "object") {
      row = row.data.data;
    // 否则如果 row.data 看起来像事件对象（包含关键字段），也用它
    } else if (row.data && typeof row.data === "object" && 
               (("领域" in row.data) || ("风险值" in row.data) || ("date" in row.data) || ("情绪" in row.data))) {
      row = row.data;
    }
  }

  // 如果 row 仍然 falsy 或不是对象，退回默认色
  if (!row || typeof row !== "object") {
    return continuousFields.includes(colorby) ? colorCont(0) : color("未知");
  }

  //
  if (continuousFields.includes(colorby)){
    if (colorby === "情绪"){
      const v = ( (row["情绪"] != null ? row["情绪"] : 0) + 1) / 2 * 100;
      return colorCont(v);
    } else if (colorby === "风险值"){
      const rv = (row["风险值"] != null ? +row["风险值"] : 0);
      return colorCont(rv);
    } else if (colorby === "时间"){
      const parse = d3.timeParse("%Y-%m-%d");
      const d = parse(row.date);
      if (!d || isNaN(d.getTime())) return colorCont(0);
      const today = new Date();
      const start = d3.timeMonth.offset(today, -6);
      const t = Math.max(0, Math.min(1, (d - start) / (today - start)));
      return colorCont(t * 100);
    }
  } else {
    // 离散字段（比如 领域/地区）
    return color(row[colorby] || "未知");
  }
 }


  // 文本辅助
  function getSentimentDescription(value) {
    if (value === 1) return "极度正面";
    if (value > 0) return "正面";
    if (value === 0) return "中立";
    if (value === -1) return "极度负面";
    if (value < 0) return "负面";
    return "未知";
  }
  function getRiskDescription(value) {
    if (value >= 80) return "极高风险";
    if (value >= 50) return "高风险";
    if (value >= 20) return "中风险";
    if (value >= 0) return "低风险";
    return "未知";
  }


  // 隐藏侧边栏
  function hideSidebar() {
    try {
      //在函数内部实时查找元素
      const sidebar = d3.select("#event-sidebar");
      const eventList = d3.select("#event-list");
      const eventDetails = d3.select("#event-details");
      const detailsSummary = d3.select("#details-summary");
      const detailsPosts = d3.select("#details-posts");

      if (!sidebar.node()) return; // 安全退出

      sidebar.classed("open", false); // 移除 open 类 (CSS 负责动画)
      
      // 匹配CSS动画 (0.3s)
      setTimeout(() => {
        if(eventList.node()) eventList.html("");
        if(eventDetails.node()) eventDetails.style("visibility", "hidden");
        if(detailsSummary.node()) detailsSummary.text("点击右侧列表中的事件以查看详情。");
        if(detailsPosts.node()) detailsPosts.text("(热门贴文内容)");
      }, 300); 
    } catch (err) {
       console.error("Error hiding sidebar:", err);
    }
  }
  window.hideSidebar = hideSidebar; // 暴露给全局

  // 填充侧边栏并显示
  function populateAndShowSidebar(nodeData) {
    // 【修复】在函数内部实时查找元素
    const sidebar = d3.select("#event-sidebar");
    const sidebarTitle = d3.select("#sidebar-title");
    const eventList = d3.select("#event-list");
    const closeBtn = d3.select("#close-sidebar-btn");
    const eventDetails = d3.select("#event-details");
    const detailsSummary = d3.select("#details-summary");
    const detailsPosts = d3.select("#details-posts");

    if (!sidebar.node()) {
      console.error("FATAL ERROR: Can't find #event-sidebar. Did you move it inside #central-vis in your HTML?");
      return;
    }

    // 【修复】JS只负责添加 'open' 类，CSS 负责所有样式和动画
    sidebar.classed("open", true); 

    // 绑定关闭按钮
    if (closeBtn.node()) {
      closeBtn.on("click", hideSidebar);
    }

   
    sidebarTitle.text(`"${nodeData.data.name}" 事件列表`);
    eventList.html("");

    let leaves = [];
    try {
      leaves = nodeData.leaves ? nodeData.leaves() : (nodeData.children || []).flatMap(c => c.leaves ? c.leaves() : (c.children||[]));
    } catch (err) {
      leaves = [];
    }

    if (leaves && leaves.length > 0) {
      const sortedChildren = leaves.sort((a,b) => d3.ascending(a.data.name, b.data.name));
      sortedChildren.forEach(childNode => {
        const event = childNode.data.data || childNode.data;
        const li = eventList.append("li")
          .text(`${event.name} (风险: ${event["风险值"] || 'N/A'})`)
          .attr("title", `点击查看 ${event.name} 详情`)
          .style("padding", "8px 12px")
          .style("list-style", "none")
          .style("border-bottom", "1px solid rgba(255,255,255,0.03)")
          .style("cursor", "pointer")
          .on("click", () => {
            eventList.selectAll("li").style("background", "none").style("color", "#a8b3cf");
            li.style("background", "#162034").style("color", "#e8e8e8");
            showEventDetails(event);
          });
      });
    } else {
      eventList.append("li").text("没有可显示的事件。").style("padding","8px 12px");
    }

    detailsSummary.text("点击右侧列表中的事件以查看详情。");
    detailsPosts.text("(热门贴文内容)");
    eventDetails.style("visibility", "hidden"); // 确保详情在列表出现时先隐藏
  }

  // 显示事件详情（左下小卡）
  function showEventDetails(event) {
    try {
      // 在函数内部实时查找元素
      const eventDetails = d3.select("#event-details");
      const detailsSummary = d3.select("#details-summary");
      const detailsPosts = d3.select("#details-posts");

      if (!eventDetails.node()) return; // 安全退出

      // CSS 负责所有定位和样式，JS 只负责设为可见
      eventDetails.style("visibility", "visible");

      const riskVal = event["风险值"] || 0;
      const sentVal = event["情绪"] || 0;

      //待修改
      const summaryText = `${event.name}: 发生于 ${event.date || 'N/A'} 的 ${event.领域 || '未知'} 事件。 地区: ${event.地区 || '未知'}。 情绪: ${getSentimentDescription(sentVal)} (${(sentVal||0).toFixed(2)}) 风险: ${getRiskDescription(riskVal)} (${(riskVal||0).toFixed(1)})`;
      const postsText = `贴文1: "关于 ${event.name} 的看法..." \n贴文2: "最新消息... (示例内容，请用真实数据替换)"`;

      detailsSummary.text(summaryText);
      detailsPosts.text(postsText);
    } catch (err) {
      console.error("Error showing event details:", err);
    }
  }

  

  // ---------------- renderBubbles ----------------
 function renderBubbles(data, attribute, colorby){
  // ==== 1. 预清理：平滑移除与 beeswarm/risk/x-axis 相关的残留元素 ====
  rootGroup.selectAll(".beeswarm-leaf, .region-dot-risk, .risk-grid, .risk-labels, .x-axis")
    .interrupt()
    .transition().duration(transitionDuration/1.5)
    .style("opacity", 0)
    .attr("r", 0)
    .remove();

  // 清理上一次 renderBubbles 留下的所有 g 容器
  rootGroup.selectAll("g.pack-parent, g.pack-leaf-g")
    .interrupt() 
    .transition().duration(transitionDuration / 2) 
    .attr("transform", `translate(${currentWidth/2},${currentHeight/2})scale(0)`)
    .style("opacity", 0)
    .remove();

  // 隐藏 tooltip
  tooltip.style("visibility","hidden").html("");

  // 重置 rootGroup 的 transform (防止从蜂群图切换时坐标错乱)
  rootGroup.interrupt()
    .transition().duration(transitionDuration)
    .attr("transform", "translate(0,0)")
    .style("opacity", 1);

  // ==== 2. 构造 pack 数据 ====
  const groups = d3.group(data, d => d[attribute] || "未知");
  const packData = {
    name: "root",
    children: Array.from(groups, ([k, arr]) => ({
      name: k,
      children: arr.map(e => ({ name: e.name, data: e, value: e["热度"] || 1 }))
    }))
  };

  const packRoot = d3.pack()
    .size([currentWidth, currentHeight])
    .padding(10)(
      d3.hierarchy(packData)
        .sum(d => d.value)
        .sort((a, b) => b.value - a.value)
    );

  // ==== 3. 保持 focus 在新树上有效 ====
  if (focus && focus.depth > 0) {
    const newFocusNode = packRoot.descendants().find(d => d.data.name === focus.data.name);
    focus = newFocusNode || packRoot;
  } else {
    focus = packRoot;
  }

  // ==== 4. 分离父节点（groups）和叶子（事件）数组 ====
  const parentNodes = packRoot.descendants().filter(d => d.children && d.parent);
  const leafNodes   = packRoot.descendants().filter(d => !d.children);

  // ==== 5. 父节点绑定（外层大圆 & label path & label） ====
  const parentSel = rootGroup.selectAll("g.pack-parent").data(parentNodes, d => d.data.name);

  // exit 父节点：平滑缩小并移除
  parentSel.exit().interrupt()
    .transition().duration(transitionDuration)
    .attr("transform", `translate(${currentWidth/2},${currentHeight/2})scale(0)`)
    .style("opacity", 0)
    .remove();

  // enter 父节点（从 focus 中心入场）
  const parentEnter = parentSel.enter().append("g").attr("class","pack-parent")
    .attr("transform", d => `translate(${focus.x},${focus.y})`)
    .style("opacity", 0);

  // 父圆（外圈）
  parentEnter.append("circle")
    .attr("class","pack-parent-circle")
    .attr("r", 0)
    .attr("fill", "none")
    .attr("stroke", "#0f1e39")
    .attr("stroke-width", 1)
    .style("pointer-events", "none");

  // label path 占位（真实 id 与 d 属性在 merge 时写入）
  parentEnter.append("path")
    .attr("class","label-path")
    .attr("fill", "none")
    .attr("stroke", "none")
    .style("pointer-events", "none");

  // label text（textPath 会在 merge 时创建）
  parentEnter.append("text")
    .attr("class","group-label")
    .style("fill", "#1a03e7")
    .style("font-weight", "bold")
    .style("pointer-events", "auto")
    .style("cursor", "pointer");

  // merge 父节点并更新位置、半径、label path 与 textPath
  const parentMerged = parentEnter.merge(parentSel);

  parentMerged.transition().duration(transitionDuration)
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .style("opacity", 1);

  parentMerged.select("circle.pack-parent-circle")
    .transition().duration(transitionDuration)
    .attr("r", d => d.r || 0);

  // 为每个父节点生成唯一 id 并把 textPath 绑定到该 path（避免冲突）
  parentMerged.each(function(d,i){
    const g = d3.select(this);
    // 生成较安全的 id：把名字里的空白与特殊字符简单替换
    const safeName = (d.data.name || "group").replace(/[^\w\-]/g, "_");
    const pid = `path-for-${safeName}_${i}`;
    const labelPadding = 5;
    const radius = (d.r || 0) + labelPadding;
    g.select("path.label-path").attr("id", pid).attr("d", `M ${-radius},0 A ${radius},${radius} 0 0,1 ${radius},0`);

    // 清理已有 textPath 并重建（确保文字更新）
    const txt = g.select("text.group-label");
    txt.selectAll("textPath").remove();
    txt.append("textPath")
      // 使用 xlink:href 保持向后兼容（部分环境需要）
      .attr("xlink:href", `#${pid}`)
      .attr("startOffset", "50%")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .text(d.data.name)
      .on("click", (evt, d) => { // 确保 (evt, d) 都在
        evt.stopPropagation();
        // console.log("1. CLICKED on text:", d.data.name); 
        populateAndShowSidebar(d);
      });
  });

  // 将父 group 提升到顶层，保证 label 清晰
  rootGroup.selectAll("g.pack-parent").raise();

  // ==== 6. 叶子节点绑定（事件小圆） ====
  const leafSel = rootGroup.selectAll("g.pack-leaf-g").data(leafNodes, d => d.data.name);

  // exit 叶子：收缩并移除
  leafSel.exit().interrupt()
    .transition().duration(transitionDuration/1.5)
    .attr("transform", `translate(${currentWidth/2},${currentHeight/2})scale(0)`)
    .style("opacity", 0)
    .remove();

  // enter 叶子：从 focus 中心入场
  const leafEnter = leafSel.enter().append("g").attr("class","pack-leaf-g")
    .attr("transform", d => {
      const prev = nodePositionCache.get(d.data.name);
      return prev ? `translate(${prev.x},${prev.y})` : `translate(${focus.x},${focus.y})`;
    })
    .style("opacity", d => nodePositionCache.has(d.data.name) ? 1 : 0);

  leafEnter.append("circle")
    .attr("class","pack-leaf")
    .attr("r", d => nodePositionCache.has(d.data.name) ? Math.max(3, d.r || 3) : 0)
    .attr("fill", d => getColor(d.data.data, colorby))
    .style("cursor", "pointer");

  // merge 叶子并设置位置、半径、颜色
  const leafMerged = leafEnter.merge(leafSel);

  leafMerged.transition().duration(transitionDuration)
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .style("opacity", 1);

  leafMerged.select("circle.pack-leaf")
    .transition().duration(transitionDuration)
    .attr("r", d => Math.max(3, d.r || 3))
    .attr("fill", d => getColor(d.data.data, colorby))
    .attr("stroke", "none");

  // 叶子交互：tooltip、hover、click（click 放大所属父组或显示详情）
  leafMerged.on("mouseover", function(evt, d){
    d3.select(this).select("circle").attr("stroke","#6886ff").attr("stroke-width",2);
    const e = d.data.data;
    const riskVal = e["风险值"] || 0;
    const sentVal = e["情绪"] || 0;
    tooltip.style("visibility","visible").html(
      `<div style="background:#0b1726;border:1px solid rgba(255,255,255,0.03);padding:8px;border-radius:6px;color:#e8f1ff;">
         <div style="font-weight:bold;margin-bottom:6px;">${e.name}</div>
         <div>领域: ${e["领域"] || '未知'}</div>
         <div>热度: ${e["热度"] || 'N/A'}</div>
         <div>时间: ${e.date || 'N/A'}</div>
         <div>地区: ${e["地区"] || '未知'}</div>
         <div>情绪: ${getSentimentDescription(sentVal)} (${(sentVal||0).toFixed(2)})</div>
         <div>风险: ${getRiskDescription(riskVal)} (${(riskVal||0).toFixed(1)})</div>
       </div>`
    );
  }).on("mousemove", function(evt){
    tooltip.style("left",(evt.pageX+12)+"px").style("top",(evt.pageY+12)+"px");
  }).on("mouseout", function(evt, d){
    d3.select(this).select("circle").attr("stroke","none").attr("stroke-width",0);
    tooltip.style("visibility","hidden");
  }).on("click", function(evt, d){
    evt.stopPropagation();
    const parent = d.parent;
    if (parent && parent.depth > 0) {
      zoomTo(parent); // (注意: 您的代码中没有 zoomTo 函数，这里假设它存在或将来会添加)
    } else {
      showEventDetails(d.data.data);
    }
  });

  // 确保父群组（带 label 的）在上层
  leafNodes.forEach(d => {
    nodePositionCache.set(d.data.name, {x: d.x, y: d.y});
  });

  rootGroup.selectAll("g.pack-parent").raise();
}


  // ---------------- renderBeeswarm ----------------
  function renderBeeswarm(data, attribute, colorby){
    hideSidebar();

    // === 关键清理：平滑移除 pack (气泡图) 相关元素，避免残留 ===
    // 1) 淡出并移除 pack 内的 leaf / parent circle
    rootGroup.selectAll(".pack-leaf, .pack-parent-circle")
      .interrupt()
      .transition().duration(transitionDuration/1.5)
      .attr("r", d => nodePositionCache.has(d.id) ? 5 : 0)
      .style("opacity", d => nodePositionCache.has(d.id) ? 1 : 0)
      .remove();

    // 2) 淡出并移除 pack 的 g 容器
    rootGroup.selectAll("g.pack-parent, g.pack-leaf-g")
      .interrupt()
      .transition().duration(transitionDuration/1.5)
      .style("opacity", 0)
      .attr("transform", `translate(${currentWidth/2},${currentHeight/2})scale(0)`)
      .remove();

    // 3) 淡出并移除 pack 的 label
    rootGroup.selectAll(".group-label")
      .interrupt()
      .transition().duration(transitionDuration/1.5)
      .style("opacity", 0)
      .remove();

    // 4) 淡出并移除可能的风险带（如果存在）
    rootGroup.selectAll(".risk-grid, .region-dot-risk, .risk-labels, .vertical-grid-line, .risk-number-labels") // <-- 【已更新】添加 .vertical-grid-line 清理
      .interrupt()
      .transition().duration(transitionDuration/1.5)
      .style("opacity", 0)
      .remove();

    // 5) 淡出旧 beeswarm 点（若切换到 beeswarm 再切回会重复），保持平滑
    rootGroup.selectAll(".beeswarm-leaf")
      .interrupt()
      .transition().duration(transitionDuration/1.5)
      .attr("r", 0)
      .style("opacity", 0)
      .remove();

    // 清理 x-axis（svg 或 rootGroup）
    svg.selectAll(".x-axis").interrupt().transition().duration(transitionDuration/2).style("opacity",0).remove();
    rootGroup.selectAll(".x-axis").interrupt().transition().duration(transitionDuration/2).style("opacity",0).remove();

    focus = null;

    const padding = {left:60, right:20, top:20, bottom:40}; // left 增加以显示风险级别文字
    const innerW = currentWidth - padding.left - padding.right;
    const innerH = currentHeight - padding.top - padding.bottom;
    const axisBaseline = Math.max(padding.top, currentHeight - 50); // keep axis 50px above canvas bottom

    const parse = d3.timeParse("%Y-%m-%d");
    let domain;

    if (attribute === "情绪") {
      domain = [-1, 1];
    } else if (attribute === "风险值") {
      domain = [0, 100];
    } else if (attribute === "时间") {
      const today = new Date();
      let startDate;
      const activeBtn = d3.select(".time-filter button.active").node();
      const timeRange = activeBtn ? activeBtn.dataset.range : 'all';
      if (timeRange === 'week') {
        startDate = d3.timeDay.offset(today, -7);
      } else if (timeRange === 'month') {
        startDate = d3.timeMonth.offset(today, -1);
      } else if (timeRange === 'half-year') {
        startDate = d3.timeMonth.offset(today, -6);
      } else {
        const dates = data.map(d => parse(d.date)).filter(d => d && !isNaN(d.getTime()));
        startDate = dates.length ? d3.min(dates) : d3.timeMonth.offset(today, -6);
      }
      domain = [startDate, today];
    }

    const x = d3.scaleLinear().range([0, innerW]);
    const xTime = d3.scaleTime().range([0, innerW]);

    if (attribute === "时间"){
      xTime.domain(domain);
      x.domain(xTime.domain());
      data.forEach(d => d.__x = xTime(parse(d.date)));
    } else {
      x.domain(domain);
      data.forEach(d => d.__x = x(d[attribute]));
    }

    // 若 attribute 为 风险值，进行特定布局（并且使入场平滑）
    if (attribute === "风险值") {
      // 绘制风险带 + 左侧标签（淡入）
      const gridGroup = rootGroup.append("g").attr("class","risk-grid").style("opacity",0);
      const bandPositions = {
        low: padding.top + innerH * 0.18,
        mid: padding.top + innerH * 0.5,
        high: padding.top + innerH * 0.82
      };

      ["low","mid","high"].forEach(key => {
        gridGroup.append("line")
          .attr("x1", padding.left).attr("x2", padding.left + innerW)
          .attr("y1", bandPositions[key]).attr("y2", bandPositions[key])
          .attr("stroke", "rgba(249, 242, 242, 0.03)")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "4 6");
      });

      const labelGroup = gridGroup.append("g").attr("class","risk-labels").style("opacity",0);
      labelGroup.append("text")
        .attr("x", padding.left - 50)
        .attr("y", bandPositions.low)
        .attr("dominant-baseline","middle")
        .style("fill","#9fb3d8")
        .style("font-size","20px")
        .text("低风险");
      labelGroup.append("text")
        .attr("x", padding.left - 50)
        .attr("y", bandPositions.mid)
        .attr("dominant-baseline","middle")
        .style("fill","#9fb3d8")
        .style("font-size","20px")
        .text("中风险");
      labelGroup.append("text")
        .attr("x", padding.left - 50)
        .attr("y", bandPositions.high)
        .attr("dominant-baseline","middle")
        .style("fill","#9fb3d8")
        .style("font-size","20px")
        .text("高风险");

      // 平滑显现风险带与标签
      gridGroup.transition().duration(transitionDuration).style("opacity",1);
      labelGroup.transition().duration(transitionDuration).style("opacity",1);


      // ???????????
      const numSegments = 10;
      const verticalLineSpacing = innerW / numSegments;
      const verticalLineHeight = innerH;
      const verticalLinePositions = d3.range(1, numSegments).map(i => padding.left + i * verticalLineSpacing);
      const xBounds = verticalLinePositions.length
        ? [verticalLinePositions[0], verticalLinePositions[verticalLinePositions.length - 1]]
        : [padding.left, padding.left + innerW];

      const numberLabelGroup = gridGroup.append("g").attr("class","risk-number-labels").style("opacity",0);

      verticalLinePositions.forEach((xPos, idx) => {
        gridGroup.append("line")
          .attr("class", "vertical-grid-line")
          .attr("x1", xPos).attr("x2", xPos)
          .attr("y1", padding.top).attr("y2", padding.top + verticalLineHeight)
          .attr("stroke", "rgba(16, 4, 4, 0.08)")
          .attr("stroke-width", 1)
          .style("opacity", 0)
          .transition().duration(transitionDuration).style("opacity", 1);

        numberLabelGroup.append("text")
          .attr("x", xPos)
          .attr("y", axisBaseline + 16)
          .attr("text-anchor","middle")
          .style("fill","#9fb3d8")
          .style("font-size","14px")
          .text(idx + 1);
      });

      numberLabelGroup.transition().duration(transitionDuration).style("opacity",1);

      const buffer = 10;
      let pointRangeStart = xBounds[0] + buffer;
      let pointRangeEnd = xBounds[1] - buffer;
      if (pointRangeEnd <= pointRangeStart) {
        pointRangeStart = xBounds[0];
        pointRangeEnd = xBounds[1];
      }
      const pointScale = d3.scaleLinear()
        .domain([0, 100])
        .range([pointRangeStart, pointRangeEnd])
        .clamp(true);

      // 计算目标像素 x+y
      data.forEach(d => {
        const rv = d["?????"] != null ? +d["?????"] : 0;
        d.__x = pointScale(rv);
        if (rv < 20) {
          d.__bandY = bandPositions.low;
        } else if (rv < 50) {
          d.__bandY = bandPositions.mid;
        } else {
          d.__bandY = bandPositions.high;
        }
      });

      // 力导向，防碰撞
      const nodes = data.map(d => ({x: d.__x, y: d.__bandY, data: d, id: d.name}));
      const sim = d3.forceSimulation(nodes)
        .force("x", d3.forceX(d => d.x).strength(1))
        .force("y", d3.forceY(d => d.y).strength(0.9))
        .force("collide", d3.forceCollide(6))
        .stop();
      for (let i=0;i<300;i++) sim.tick();

      const minX = xBounds[0];
      const maxX = xBounds[1];
      nodes.forEach(node => {
        node.x = Math.min(maxX, Math.max(minX, node.x));
      });

      // 平滑入场：从画布中心淡入并移动到目标
      const startX = currentWidth / 2;
      const startY = currentHeight / 2;

      const circles = rootGroup.selectAll(".region-dot-risk")
        .data(nodes, d => d.id);

      circles.exit()
        .interrupt()
        .transition().duration(transitionDuration/1.5)
        .attr("r", 0)
        .style("opacity", 0)
        .remove();

      const circlesEnter = circles.enter().append("circle")
        .attr("class", "region-dot-risk beeswarm-leaf")
        .attr("cx", d => {
          const prev = nodePositionCache.get(d.id);
          return prev ? prev.x : startX;
        })
        .attr("cy", d => {
          const prev = nodePositionCache.get(d.id);
          return prev ? prev.y : startY;
        })
        .attr("r", d => nodePositionCache.has(d.id) ? 5 : 0)
        .style("opacity", d => nodePositionCache.has(d.id) ? 1 : 0)
        .attr("stroke", "#1f2835")
        .attr("stroke-width", 1)
        .on("mouseover", function(evt, d){
          d3.select(this).transition().duration(120).attr("r", 8).attr("stroke","#7fb3ff").attr("stroke-width",2);
          const e = d.data;
          const riskVal = e["风险值"] || 0;
          const sentVal = e["情绪"] || 0;
          const sentimentColor = (sentVal >= 0.2) ? "#66ffb3" : (sentVal <= -0.2 ? "#ff8a8a" : "#ffd966");
          const riskColor = (riskVal >= 50) ? "#ff9b6b" : (riskVal >= 20 ? "#ffd36b" : "#77d2a8");
          const cardHtml = `
            <div style="min-width:240px;background:linear-gradient(180deg, rgba(10,26,58,0.95), rgba(6,18,37,0.95));border:1px solid rgba(255,255,255,0.06);box-shadow:0 8px 24px rgba(0,0,0,0.6);border-radius:6px;padding:12px;color:#e8f1ff;font-family:Arial;">
              <div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#bfe1ff;">事件详情</div>
              <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#ffffff;">${e.name}</div>
              <div style="font-size:12px;line-height:1.6;color:#cbe6ff;">
                <div>领域: <span style="color:#ade1ff">${e.领域 || '未知'}</span></div>
                <div>热度: <span style="color:#a8e0ff">${e['热度'] || 'N/A'}</span></div>
                <div>发生时间: <span style="color:#a8e0ff">${e.date || 'N/A'}</span></div>
                <div>地区: <span style="color:#a8e0ff">${e.地区 || '未知'}</span></div>
                <div>情绪: <span style="color:${sentimentColor}">${getSentimentDescription(sentVal)} (${(sentVal||0).toFixed(2)})</span></div>
                <div>风险: <span style="color:${riskColor}">${getRiskDescription(riskVal)} (${(riskVal||0).toFixed(1)})</span></div>
              </div>
            </div>
          `;
          tooltip.html(cardHtml).style("visibility","visible");
        })
        .on("mousemove", function(evt){
          const cardWidth = 260;
          let left = evt.pageX + 12;
          if (left + cardWidth > window.innerWidth - 8) {
            left = evt.pageX - cardWidth - 12;
          }
          tooltip.style("left", left + "px").style("top",(evt.pageY - 20) + "px");
        })
        .on("mouseout", function(){
          d3.select(this).transition().duration(120).attr("r", 5).attr("stroke","none");
          tooltip.style("visibility","hidden").html("");
        });

      circles.merge(circlesEnter)
        .transition().duration(transitionDuration)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", 5)
        .style("opacity", 1)
        .attr("fill", d => getColor(d.data, colorby));

      nodes.forEach(node => {
        nodePositionCache.set(node.id, {x: node.x, y: node.y});
      });

      // 确保 rootGroup 的 transform 被重置 (如果之前被移动过)
      rootGroup.interrupt().transition().duration(transitionDuration).attr("transform", `translate(0,0)`);

      return;
    }

    // 非风险值常规蜂群（时间/情绪）
    const nodes = data.map(d => ({x: d.__x + padding.left, y: currentHeight/2, data: d, id: d.name}));

    const sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX(d => d.x).strength(1))
      .force("y", d3.forceY(currentHeight/2))
      .force("collide", d3.forceCollide(8))
      .stop();
    for (let i=0;i<200;i++) sim.tick();

    // axis
    let gAxis = svg.selectAll(".x-axis").data([null]);
    gAxis.exit().interrupt().transition().duration(transitionDuration).style("opacity", 0).remove();

    const gAxisEnter = gAxis.enter().append("g")
      .attr("class", "x-axis")
      .style("opacity", 0);
    let bottomAxis;

    if (attribute === "时间") {
      bottomAxis = d3.axisBottom(xTime).tickFormat(d3.timeFormat("%Y-%m-%d"));
      const activeBtn = d3.select(".time-filter button.active").node();
      const timeRange = activeBtn ? activeBtn.dataset.range : 'all';
      if (timeRange === 'week') {
        bottomAxis.ticks(d3.timeDay.every(1));
      }
    } else {
      bottomAxis = d3.axisBottom(x);
    }

    gAxisEnter.merge(gAxis)
      .attr("transform", `translate(${padding.left},${axisBaseline})`)
      .transition().duration(transitionDuration)
      .style("opacity", 1)
      .call(bottomAxis);
    
    // 这里是蜂群图设置 transform 的地方
    rootGroup.interrupt().transition().duration(transitionDuration).attr("transform", `translate(${padding.left},${padding.top})`);

    // circles: enter from center -> transition to nodes (平滑)
    const circles = rootGroup.selectAll("circle.beeswarm-leaf")
      .data(nodes, d => d.id);

    circles.exit().interrupt().transition().duration(transitionDuration/1.5).attr("r", 0).style("opacity", 0).remove();

    const circlesEnter = circles.enter().append("circle")
      .attr("class", "beeswarm-leaf")
      .attr("r", d => nodePositionCache.has(d.id) ? 5 : 0)
      .style("opacity", d => nodePositionCache.has(d.id) ? 1 : 0)
      .attr("fill", d => getColor(d.data, colorby))
      .attr("cx", d => {
        const prev = nodePositionCache.get(d.id);
        const fallback = currentWidth/2 - padding.left; // �ӻ��������볡
        return prev ? prev.x - padding.left : fallback;
      })
      .attr("cy", d => {
        const prev = nodePositionCache.get(d.id);
        const fallback = currentHeight/2 - padding.top;
        return prev ? prev.y - padding.top : fallback;
      })
      .on("mouseover", function(evt, d){
        d3.select(this).transition().duration(150).attr("r", 8).attr("stroke","#6886ff").attr("stroke-width",2);
        const e = d.data;
        const riskVal = e["风险值"] || 0;
        const sentVal = e["情绪"] || 0;
        tooltip.style("visibility","visible").html(
            `<div style="background:#0b1726;border:1px solid rgba(255,255,255,0.03);padding:8px;border-radius:6px;color:#e8f1ff;">
              <div style="font-weight:bold;margin-bottom:6px;">${e.name}</div>
               <div>领域: ${e["领域"] || '未知'}</div>
               <div>热度: ${e["热度"] || 'N/A'}</div>
               <div>时间: ${e.date || 'N/A'}</div>
               <div>地区: ${e["地区"] || '未知'}</div>
               <div>情绪: ${getSentimentDescription(sentVal)} (${(sentVal||0).toFixed(2)})</div>
               <div>风险: ${getRiskDescription(riskVal)} (${(riskVal||0).toFixed(1)})</div>
            </div>`
        );
      })
      .on("mousemove", function(evt){
        tooltip.style("left",(evt.pageX+8)+"px").style("top",(evt.pageY+8)+"px");
      })
      .on("mouseout", function(){
        d3.select(this).transition().duration(150).attr("r", 5).attr("stroke","none");
        tooltip.style("visibility","hidden").html("");
      });

    const circlesCombined = circlesEnter.merge(circles);

    circlesCombined.transition().duration(transitionDuration)
      .attr("r", 5)
      .style("opacity", 1)
      .attr("fill", d => getColor(d.data, colorby))
      .attr("cx", d => d.x - padding.left)
      .attr("cy", d => d.y - padding.top);

    nodes.forEach(node => {
      nodePositionCache.set(node.id, {x: node.x, y: node.y});
    });
  }

  // 主渲染入口
  window.renderCentral = function(data){
    const attr = document.getElementById("central-attribute").value;
    const colorby = document.getElementById("central-colorby").value;

    const parse = d3.timeParse("%Y-%m-%d");
    let processedData = data;
    const activeBtn = d3.select(".time-filter button.active").node();
    const timeRange = activeBtn ? activeBtn.dataset.range : 'all';

    if (timeRange !== 'all') {
      const today = new Date();
      let startDate;
      if (timeRange === 'week') {
        startDate = d3.timeDay.offset(today, -7);
      } else if (timeRange === 'month') {
        startDate = d3.timeMonth.offset(today, -1);
      } else if (timeRange === 'half-year') {
        startDate = d3.timeMonth.offset(today, -6);
      }
      processedData = data.filter(d => {
        const date = parse(d.date);
        return date && date >= startDate && date <= today;
      });
    }

    rootGroup.style("visibility", "visible");

    // 当切换回离散属性时，提前平滑移除风险相关视图，防止残留（保守处理）
    if (discreteFields.includes(attr)) {
      rootGroup.selectAll(".risk-grid, .region-dot-risk, .risk-labels")
        .interrupt()
        .transition().duration(transitionDuration/2).style("opacity",0).remove();
      rootGroup.selectAll(".x-axis").interrupt().transition().duration(transitionDuration/2).style("opacity",0).remove();
      svg.selectAll(".x-axis").interrupt().transition().duration(transitionDuration/2).style("opacity",0).remove();
      tooltip.style("visibility","hidden").html("");
    }

    if (discreteFields.includes(attr)) {
      renderBubbles(processedData, attr, colorby);
    } else {
      renderBeeswarm(processedData, attr, colorby);
    }
  }
  


  /* === 使用《医疗健康相关话题分类及识别指南》实现的精确分类器 ===
   将此函数放入 central_vis.js，替换旧的 classifyHealthTopic 实现。
   返回值：{ bigCategory, subCategory, matchScore, matchedKeys }
*/
function classifyHealthTopic(event) {
  const txt = ((event.name || '') + ' ' + (event['领域'] || '') + ' ' + (event.summary || '')).toLowerCase();

  // 定义 9 大类与 21 小类（直接对应指南章节 1.1-9.2）
  const taxonomy = [
    { big: '传染病与公共卫生应急', subs: [
        { sub: '新发/突发传染病', keys: ['不明原因', '新型', '突发', '聚集性', '输入性', '不明病原', '不明原因肺炎'] },
        { sub: '已知传染病暴发', keys: ['甲流','诺如病毒','手足口病','病例激增','暴发','群体感染','聚集感染'] },
        { sub: '疫苗与防疫政策', keys: ['疫苗','接种','不良反应','防疫政策','隔离','核酸','健康码','防控措施'] }
    ]},
    { big: '医疗服务与医患矛盾', subs: [
        { sub: '恶性医患冲突', keys: ['打砸','医闹','袭击','堵门','暴力','殴打 医护','袭击 医护'] },
        { sub: '重大医疗事故', keys: ['手术失误','误诊','漏诊','院内感染','医疗事故','死亡 术后'] },
        { sub: '医疗资源与服务争议', keys: ['床位','挂号难','救护车 延误','120 延迟','医护短缺','排队','就诊难'] }
    ]},
    { big: '食品药品安全', subs: [
        { sub: '食品安全突发情况', keys: ['食物中毒','外卖','集体腹泻','过期 食品','非法 添加','假冒'] },
        { sub: '药品安全突发情况', keys: ['假药','劣药','药品不良反应','聚集性 不良反应','药品审批','疫苗不良'] }
    ]},
    { big: '环境与灾害关联健康问题', subs: [
        { sub: '突发污染健康影响', keys: ['排污','饮用水 污染','有毒 气体','污染 致病','污染 健康'] },
        { sub: '灾害次生健康风险', keys: ['高温','暴雨','中暑','灾后 疫情','皮肤病','洪水','地震'] }
    ]},
    { big: '特殊场景与群体健康', subs: [
        { sub: '公共场合聚集性健康问题', keys: ['演唱会','展会','地铁','多人晕倒','集体不适','现场 中暑'] },
        { sub: '特殊群体健康危机', keys: ['学校 班级','养老院','老人','农民工','职业病','集体发热'] }
    ]},
    { big: '健康管理与养生', subs: [
        { sub: '养生谣言与伪科学', keys: ['养生 谣言','偏方','酸碱体质','伪科学','网红 养生'] },
        { sub: '慢病管理与健康干预', keys: ['高血压','糖尿病','慢性病','慢病 管理','自我管理','干预'] },
        { sub: '健康生活方式', keys: ['减肥','健身','睡眠','饮食','运动','健康 食谱'] }
    ]},
    { big: '医疗行业与技术动态', subs: [
        { sub: '医疗技术创新', keys: ['新药','获批','临床 试验','AI 诊断','微创','技术 创新'] },
        { sub: '医疗行业热点', keys: ['医院 等级','医护 职业','薪酬 改革','私立 医院','行业 热点'] }
    ]},
    { big: '健康政策与公共服务', subs: [
        { sub: '医疗保障政策', keys: ['医保','报销','药品 集中 采购','异地 就医','医疗 保障'] },
        { sub: '公共健康服务', keys: ['免费 体检','疫苗 预约','社区 义诊','公共 健康 服务'] }
    ]},
    { big: '健康观念与社会现象', subs: [
        { sub: '心理健康话题', keys: ['抑郁','焦虑','心理 健康','心里 疗','情绪 管理','职场 焦虑'] },
        { sub: '健康相关社会争议', keys: ['代孕','安乐死','身材 焦虑','容貌 焦虑','伦理 争议'] }
    ]}
  ];

  // normalise text
  const matched = [];
  let score = 0;

  // iterate taxonomy with priority (top-down)
  for (const group of taxonomy) {
    for (const sub of group.subs) {
      for (const key of sub.keys) {
        if (txt.indexOf(key) !== -1) {
          matched.push({ big: group.big, sub: sub.sub, key: key });
          score += 1;
        }
      }
      // 如果当前子类中有命中，则优先返回该子类（较高优先级）
      if (matched.length > 0) {
        // 找到最有代表性的子类（出现次数最多）
        const subCounts = {};
        matched.forEach(m => {
          const k = m.big + '||' + m.sub;
          subCounts[k] = (subCounts[k] || 0) + 1;
        });
        // 选最大计数
        const best = Object.entries(subCounts).sort((a,b) => b[1]-a[1])[0][0];
        const parts = best.split('||');
        return {
          bigCategory: parts[0],
          subCategory: parts[1],
          matchScore: score,
          matchedKeys: matched.map(m => m.key)
        };
      }
    }
  }

  // fallback：若没有任何关键字命中，但事件领域明确为“健康/医疗”，归为“健康管理与养生 / 健康生活方式”或“其他健康话题”
  const domain = (event['领域'] || '').toLowerCase();
  if (/健|医|医院|药|疫苗|防疫/.test(domain) || /健|医|医院|药|疫苗|防疫/.test(txt)) {
    return { bigCategory: '健康管理与养生', subCategory: '健康生活方式', matchScore: 0, matchedKeys: [] };
  }

  // 最终兜底
  return { bigCategory: '其他健康话题', subCategory: '未分类', matchScore: 0, matchedKeys: [] };
}




  // 事件绑定
  d3.select("#central-attribute").on("change", () => {
    focus = null;
    attrSel.property("disabled", false);
    if (window.__centralData__) {
      window.renderCentral(window.__centralData__);
    }
  });
  d3.select("#central-colorby").on("change", () => {
    const attr = document.getElementById("central-attribute").value;
    if (discreteFields.includes(attr)) {
      focus = null;
    }
    if (window.__centralData__) {
      window.renderCentral(window.__centralData__);
    }
  });
  d3.selectAll(".time-filter button").on("click", function() {
    d3.selectAll(".time-filter button").classed("active", false);
    d3.select(this).classed("active", true);
    const attr = document.getElementById("central-attribute").value;
    if (discreteFields.includes(attr)) {
      focus = null;
    }
    if (window.__centralData__) {
      window.renderCentral(window.__centralData__);
    }
  });

  const chartViewBtn = d3.select("#chart-view-btn");
  chartViewBtn.on("click", function() {
    chartViewBtn.classed("active", true);
    d3.select("#map-view-btn").classed("active", false);
    attrSel.property("disabled", false);
    focus = null;
    if (window.__centralData__) {
      window.renderCentral(window.__centralData__);
    }
  });

  // 响应式
  function handleResize() {
    const newWidth = container.node().getBoundingClientRect().width;
    const newHeight = container.node().getBoundingClientRect().height;

    if (newWidth <= 0 || newHeight <= 0) return;

    currentWidth = newWidth;
    currentHeight = newHeight;

    svg.attr("width", currentWidth).attr("height", currentHeight);

    if (window.__centralData__) {
      hideSidebar(); // 窗口缩放时隐藏侧边栏
      if (discreteFields.includes(d3.select("#central-attribute").property("value"))) {
        focus = null;
      }
      window.renderCentral(window.__centralData__);
    }

    // 【修复】删除旧的 try...catch 块，因为它不再需要，
    // CSS会处理侧边栏的响应式布局
  }

   
  /* ====== HEALTH BUTTON SETUP (粘到 central_vis.js 的末尾 IIFE 内) ====== */
 (function setupHealthButton() {
  // 建立绑定函数（放在内部以使用当前作用域的 svg/rootGroup/tooltip 等）
  function bindHealthBtn() {
    const btn = d3.select("#health-hot-btn");
    const panel = d3.select("#health-panel");

    if (!btn.node()) {
      console.warn("[health] 按钮 #health-hot-btn 未找到 —— 请确认 HTML 中存在该 id");
      return;
    }
    if (!panel.node()) {
      console.warn("[health] 面板 #health-panel 未找到 —— 请确认 HTML 中存在该 id");
      // 仍然绑定按钮，但绑定动作会先检查 panel 是否存在
    }

    btn.on("click", function() {
      // 如果面板不存在就提示并 return
      if (!panel.node()) {
        console.warn("[health] 点击触发但未找到 #health-panel；无法显示健康视图。");
        return;
      }

      const isHidden = panel.style("display") === "none" || panel.style("display") === "";
      if (isHidden) {
        // 显示健康面板，隐藏主 svg（保留数据）
        panel.style("display", "block");
        try { d3.select("#central-vis svg").style("visibility", "hidden"); } catch(e) {}
        // 取出健康事件（简单筛选：领域或标题含“健/医/疫苗/医院”等）
        const all = window.__centralData__ || [];
        const healthEvents = all.filter(d => {
          const domain = (d["领域"]||"").toString();
          const name = (d.name||"").toString();
          return /健|医|疫苗|医院|防疫|接种|疫情|疫/.test(domain + " " + name);
        });
        // 优先调用你如果已实现的 renderHealthTimeline，否则用控制台提示
        if (typeof renderHealthTimeline === "function") {
          renderHealthTimeline(healthEvents);
        } else {
          console.warn("[health] renderHealthTimeline 未定义；请确保已实现时间轴渲染函数。");
        }
      } else {
        // 隐藏健康面板并恢复主视图
        panel.style("display", "none");
        try { d3.select("#central-vis svg").style("visibility", "visible"); } catch(e) {}
        if (typeof window.renderCentral === "function") {
          window.renderCentral(window.__centralData__ || []);
        }
      }
    });

    console.info("[health] 按钮绑定已完成，点击将切换健康面板（id: #health-hot-btn / #health-panel）。");
  }

  // 如果 DOM 尚未准备好：在 DOMContentLoaded 时绑定；否则立即绑定
  if (!d3.select("#health-hot-btn").node() || !d3.select("#health-panel").node()) {
    // 在 DOMContentLoaded 时再尝试绑定（兼顾 script 加载顺序）
    document.addEventListener("DOMContentLoaded", bindHealthBtn);
    // 另外尝试短延时绑定以覆盖多数情况
    setTimeout(bindHealthBtn, 300);
  } else {
    bindHealthBtn();
  }
})();


  window.addEventListener("resize", handleResize);
  handleResize();

})();
