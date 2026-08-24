// ============================================================================
// dsh-usage-stats 客户端半边（浏览器端插件）
//
// 结构：
//   1. __ModuleLoader__.load 注册模块（dsh 插件加载协议，与 dsh-timeline 同款）
//   2. 用量账本（localStorage 持久化，version 2）：以「会话水位线」去重，
//      数据源是宿主 session.history RPC 的原始日志事件 —— 每条 assistant/message
//      自带 usage 与 message.source.model，模型归属因此精确到每次请求
//   3. 统计计算：累计 / 单日峰值 / 当前连续天数 / 最长连续天数 / 分模型序列
//   4. UsageCollector：挂在 conversation.composer.dock 的隐形采集器（渲染 null），
//      只做「变化探测」——发现快照里有超过水位线的 assistant 消息就安排一次
//      防抖的历史对账（reconcile），由对账从日志拉取并折叠
//   5. UsageSection：挂在 settings.section 的「使用统计」页面
//      （统计卡片 + 一年热力图 + 分模型时间图表）；热力图为 SVG viewBox 实现，
//      宽度 100% 自适应容器，完整 53 周一屏呈现，不出现横向滚动
//
// 数据口径：
//   - token 总数 = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
//     （四桶不相交；reasoning 已含在 output 内，不重复计）
//   - 归属日期取 assistant/message 事件时间（epoch ms），按本地时区落到自然日
//   - 模型归属取该请求 message.source.model（宿主日志记录的请求模型），
//     缺失时回退 "unknown"
// ============================================================================

window.__ModuleLoader__.load({
  id: "@kindred7/dsh-usage-stats",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const jsxrt = require("react/jsx-runtime");

    // ==========================================================================
    // 1. 样式（主题变量带字面量兜底，明暗两套都成立）
    // ==========================================================================
    const css = `
      .dus-wrap { color: var(--dsw-alias-label-primary, inherit); font-size: 13px; }
      .dus-cards { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0 18px; }
      .dus-cards-row { display: flex; gap: 10px; margin: 10px 0; }
      .dus-cards-row .dus-card { flex: 1 1 0; min-width: 0; }
      .dus-card {
        flex: 1 1 150px; min-width: 140px;
        background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));
        border: 1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.25));
        border-radius: 10px; padding: 10px 14px;
      }
      .dus-card .dus-label { font-size: 11px; opacity: .65; margin-bottom: 4px; }
      .dus-card .dus-value { font-size: 22px; font-weight: 600; line-height: 1.15; }
      .dus-card .dus-sub { font-size: 11px; opacity: .55; margin-top: 2px; }
      .dus-section-title { font-size: 13px; font-weight: 600; margin: 18px 0 8px; }
      .dus-muted { opacity: .6; font-size: 11px; }
      .dus-toolbar { display: flex; align-items: center; gap: 8px; margin: 4px 0 12px; }

      /* ---- 热力图：SVG viewBox 实现，宽度 100% 自适应，完整一年不滚动 ---- */
      .dus-heatmap-wrap { position: relative; }
      .dus-heatmap-svg { width: 100%; height: auto; display: block; cursor: pointer; }
      .dus-hcell { fill: #ebedf0; transition: opacity .15s; }
      .dus-hcell:hover { opacity: .75; }
      .dus-hcell.l1 { fill: #9be9a8; } .dus-hcell.l2 { fill: #40c463; }
      .dus-hcell.l3 { fill: #30a14e; } .dus-hcell.l4 { fill: #216e39; }
      @media (prefers-color-scheme: dark) {
        .dus-hcell { fill: #161b22; }
        .dus-hcell.l1 { fill: #0e4429; } .dus-hcell.l2 { fill: #006d32; }
        .dus-hcell.l3 { fill: #26a641; } .dus-hcell.l4 { fill: #39d353; }
      }

      .dus-legend { display: flex; align-items: center; gap: 4px; font-size: 11px; opacity: .7; margin-top: 6px; }
      .dus-cell { width: 11px; height: 11px; border-radius: 2px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); }
      .dus-cell.l1 { background: #9be9a8; } .dus-cell.l2 { background: #40c463; }
      .dus-cell.l3 { background: #30a14e; } .dus-cell.l4 { background: #216e39; }
      @media (prefers-color-scheme: dark) {
        .dus-cell.l1 { background: #0e4429; } .dus-cell.l2 { background: #006d32; }
        .dus-cell.l3 { background: #26a641; } .dus-cell.l4 { background: #39d353; }
      }

      .dus-btn { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 7px;
        border: 1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.35));
        background: transparent; color: inherit; cursor: pointer; }
      .dus-btn:hover { background: rgba(127,127,127,.12); }
      .dus-btn.on { background: rgba(127,127,127,.2); font-weight: 600; }
      .dus-btn.danger { color: #e5484d; border-color: rgba(229,72,77,.5); }

      .dus-chart-svg { width: 100%; height: auto; display: block; }
      .dus-model-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 11px; }
      .dus-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
      .dus-empty { padding: 26px 0; text-align: center; opacity: .55; }
      .dus-note { margin-top: 16px; font-size: 11px; opacity: .55; line-height: 1.6; }
      /* 热力图 tooltip：与 dsh 原生 Tooltip 视觉一致（Tooltip.module.css） */
      .dus-tooltip {
        position: fixed;
        z-index: 100;
        width: max-content;
        max-width: 50vw;
        padding: 3px 7px;
        border-radius: 8px;
        background: var(--dsw-alias-tooltip-bg, rgba(31, 41, 55, 0.95));
        color: var(--dsw-static-neutral-bluish-00, #f3f4f6);
        font-size: 13px;
        line-height: 20px;
        white-space: pre-line;
        overflow-wrap: break-word;
        pointer-events: none;
        animation: dus-tooltip-in 150ms ease-in-out;
      }
      .dus-tooltip[data-side='top'] {
        transform: translate(-50%, -100%);
      }
      @keyframes dus-tooltip-in {
        from { opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dus-tooltip { animation: none; }
      }
    `;
    if (typeof document !== "undefined") {
      const tagId = "dsh-usage-stats/styles";
      if (document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-usage-stats";
        tag.dataset.pluginCss = tagId;
        tag.textContent = css;
        document.head.appendChild(tag);
      }
    }

    // ==========================================================================
    // 2. 账本（version 2：由宿主日志事件折叠，模型精确归属）
    // ==========================================================================
    const LEDGER_KEY = "dsh-usage-stats/ledger/v1";

    function emptyLedger() { return { version: 2, days: {}, sessions: {} }; }
    function emptyDay() { return { tokens: 0, requests: 0, byModel: {} }; }

    function loadLedger() {
      try {
        const raw = localStorage.getItem(LEDGER_KEY);
        if (!raw) return emptyLedger();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return emptyLedger();
        // v1 账本由快照折叠、模型全部是 unknown：直接重建，由历史日志重新折叠
        if (parsed.version !== 2) return emptyLedger();
        return { version: 2, days: parsed.days || {}, sessions: parsed.sessions || {} };
      } catch (_e) { return emptyLedger(); }
    }

    let ledger = loadLedger();
    let saveTimer = null;
    function saveLedger() {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); } catch (_e) { /* 隐私模式等 */ }
      }, 400);
    }

    function notifyLedgerChanged() {
      try { window.dispatchEvent(new Event("dsh-usage-stats:changed")); } catch (_e) { /* 非浏览器环境 */ }
    }

    function pad2(n) { return n < 10 ? "0" + n : String(n); }
    function dayKeyOf(ts) {
      const d = new Date(ts);
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }

    function tokensOfUsage(u) {
      const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
      return {
        input: num(u.inputTokens),
        output: num(u.outputTokens),
        cacheRead: num(u.cacheReadTokens),
        cacheWrite: num(u.cacheWriteTokens)
      };
    }

    // ==========================================================================
    // 3. 历史对账：session.history 向后分页拉全量日志，折叠 assistant/message
    // ==========================================================================

    /** 把一条 assistant/message 日志事件折进账本；返回是否产生了新增。 */
    function foldMessageEvent(sid, e) {
      if (!e || typeof e.seq !== "number") return false;
      const wm = ledger.sessions[sid] || 0;
      if (!(e.seq > wm)) return false;                  // 水位线去重（含 NaN 防御）
      ledger.sessions[sid] = e.seq;                     // 无论是否有量，推进水位线
      saveLedger();
      const u = e.data && e.data.usage;
      if (!u || typeof u !== "object") return false;
      const t = tokensOfUsage(u);
      const total = t.input + t.output + t.cacheRead + t.cacheWrite;
      if (total <= 0) return false;
      const src = (e.data.message && e.data.message.source) || {};
      const model = (typeof src.model === "string" && src.model) ? src.model : "unknown";
      const dayKey = dayKeyOf(e.time || Date.now());
      const day = ledger.days[dayKey] || (ledger.days[dayKey] = emptyDay());
      day.tokens += total; day.requests += 1;
      day.byModel[model] = (day.byModel[model] || 0) + total;
      return true;
    }

    const reconciling = new Set();
    const pendingTimers = new Map();

    /**
     * 拉取一个会话的完整日志并折叠 assistant/message 事件。
     * 从窗口尾页开始，beforeSeq 向后翻页，直到翻完或落到水位线以下。
     * 日志不可读（损坏/主机不可达）时静默放弃本轮，等下次触发再试。
     */
    async function reconcileSession(sid) {
      if (reconciling.has(sid)) { scheduleReconcile(sid, 2500); return; }
      reconciling.add(sid);
      try {
        const collected = [];
        let beforeSeq;
        for (let page = 0; page < 60; page++) {
          const payload = { sessionId: sid };
          if (beforeSeq !== undefined) payload.beforeSeq = beforeSeq;
          const res = await fetch("/api/session.history", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "client-request", rpcId: "dus-" + sid + "-" + page, method: "session.history", payload })
          });
          const body = await res.json().catch(() => null);
          const value = body && body.result && body.result.ok ? body.result.value : null;
          if (!value) return;
          const events = (value.events || []).map((w) => (w && w.event) ? w.event : w);
          for (const e of events) {
            if (e && e.type === "assistant/message") collected.push(e);
          }
          const wm = ledger.sessions[sid] || 0;
          let minSeq = 0;
          for (const e of events) if (typeof e.seq === "number" && (minSeq === 0 || e.seq < minSeq)) minSeq = e.seq;
          if (!value.hasMore || events.length === 0 || (page > 0 && minSeq <= wm)) break;
          if (minSeq <= 0) break;
          beforeSeq = minSeq;
        }
        collected.sort((a, b) => a.seq - b.seq);
        let changed = false;
        for (const e of collected) {
          if (foldMessageEvent(sid, e)) changed = true;
        }
        if (changed) { saveLedger(); notifyLedgerChanged(); }
      } catch (_e) { /* 网络失败等：静默，等下次触发 */ }
      finally { reconciling.delete(sid); }
    }

    /** 安排一次防抖对账；同一会话的待执行定时器只保留最新一个。 */
    function scheduleReconcile(sid, delay) {
      if (pendingTimers.has(sid)) clearTimeout(pendingTimers.get(sid));
      const t = setTimeout(() => {
        pendingTimers.delete(sid);
        reconcileSession(sid);
      }, delay == null ? 1200 : delay);
      pendingTimers.set(sid, t);
    }

    /** 快照里最大的 assistant 消息 seq（变化探测用，不折叠）。 */
    function maxAssistantSeq(snapshot) {
      let max = 0;
      if (!snapshot || !snapshot.chat) return max;
      const order = snapshot.chat.order || [];
      for (const key of order) {
        const node = snapshot.chat.nodes.get ? snapshot.chat.nodes.get(key) : snapshot.chat.nodes[key];
        if (!node) continue;
        let seq = null;
        if (node.kind === "assistant" && typeof node.seq === "number") seq = node.seq;
        else if (node.data && node.data.finalNode && typeof node.data.finalNode.seq === "number") seq = node.data.finalNode.seq;
        if (seq !== null && seq > max) max = seq;
      }
      return max;
    }

    function computeStats() {
      const keys = Object.keys(ledger.days).sort();
      let total = 0, peak = 0, peakDay = null;
      const todayKey = dayKeyOf(Date.now());
      const yesterdayKey = dayKeyOf(Date.now() - 86400000);
      for (const k of keys) {
        const v = ledger.days[k].tokens;
        total += v;
        if (v > peak) { peak = v; peakDay = k; }
      }
      // 连续天数：以「有用量」的日子集合计算
      const has = new Set(keys.filter((k) => ledger.days[k].tokens > 0));
      let longest = 0, run = 0, prev = null;
      for (const k of [...has].sort()) {
        if (prev !== null && (new Date(k + "T00:00:00") - new Date(prev + "T00:00:00")) === 86400000) run += 1;
        else run = 1;
        if (run > longest) longest = run;
        prev = k;
      }
      let current = 0;
      const stepBack = (d) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() - 1); return dayKeyOf(x.getTime()); };
      let cursor = has.has(todayKey) ? todayKey : (has.has(yesterdayKey) ? yesterdayKey : null);
      while (cursor && has.has(cursor)) { current += 1; cursor = stepBack(cursor); }
      return {
        total,
        today: (ledger.days[todayKey] || {}).tokens || 0,
        peak, peakDay,
        currentStreak: current, longestStreak: longest,
        activeDays: has.size
      };
    }

    function formatTokens(n) {
      if (n < 1000) return String(n);
      const scaled = (v) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
      if (n < 1000000) return scaled(n / 1000) + "K";
      return scaled(n / 1000000) + "M";
    }

    // ==========================================================================
    // 4. 采集器组件：挂在 conversation.composer.dock，渲染 null
    //    只做变化探测：快照出现超过水位线的 assistant 消息 → 防抖触发历史对账
    // ==========================================================================
    function UsageCollector({ useSession }) {
      const chat = useSession((s) => s.chat);
      const sessionId = useSession((s) => s.sessionId);
      react.useEffect(() => {
        if (!chat || !sessionId) return;
        try {
          if (maxAssistantSeq({ chat }) > (ledger.sessions[sessionId] || 0)) {
            scheduleReconcile(sessionId);
          }
        } catch (_e) { /* 不影响宿主 */ }
      }, [chat, sessionId]);
      return null;
    }

    // ==========================================================================
    // 5. 设置页组件
    // ==========================================================================
    const PALETTE = ["#4e8ee0", "#3fb27f", "#e0a34e", "#c95dd8", "#e06c75", "#7bd0e0", "#98a2b3"];

    function StatCard(props) {
      return jsxrt.jsxs("div", { className: "dus-card", children: [
        jsxrt.jsx("div", { className: "dus-label", children: props.label }),
        jsxrt.jsx("div", { className: "dus-value", children: props.value }),
        props.sub ? jsxrt.jsx("div", { className: "dus-sub", children: props.sub }) : null
      ] });
    }

    /**
     * 近一年热力图：53 周 × 7 行的 SVG 网格（列优先，周日起始对齐）。
     * viewBox 定标，width:100% 缩放 —— 任何容器宽度下完整呈现一年，不滚动。
     * 悬停方块时显示与 dsh 原生 Tooltip 视觉一致的自定义 tooltip。
     * 横轴显示月份标签（每月起始位置）。
     */
    function YearHeatmap({ tick }) {
      const [hover, setHover] = react.useState(null); // { cell, clientX, clientY } | null
      const view = react.useMemo(() => {
        const CELL = 10, GAP = 3, LABEL_H = 14;
        const out = [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const start = new Date(today.getTime() - 364 * 86400000);
        start.setDate(start.getDate() - start.getDay());   // 回退到周日对齐成整列
        let max = 0;
        for (let i = 0; i < 371; i++) {
          const ts = start.getTime() + i * 86400000;
          if (ts > today.getTime()) break;
          const k = dayKeyOf(ts);
          const v = (ledger.days[k] || {}).tokens || 0;
          if (v > max) max = v;
          out.push({ ts, key: k, v, col: Math.floor(i / 7) });
        }
        for (const c of out) {
          c.level = c.v <= 0 ? 0 : Math.min(4, Math.ceil((c.v / Math.max(1, max)) * 4));
        }
        const cols = Math.max(1, Math.ceil(out.length / 7));
        // 计算月份标签：每个月第一个出现的日期所在的列；
        // 与上一个标签水平距离不足 30 单位时跳过，避免文字重叠
        const monthLabels = [];
        let lastMonth = -1;
        let lastX = -100;
        for (const c of out) {
          const m = new Date(c.ts).getMonth();
          if (m !== lastMonth) {
            const x = c.col * (CELL + GAP);
            if (x - lastX >= 30) monthLabels.push({ month: m, x });
            lastMonth = m;
            lastX = x;
          }
        }
        const MONTH_NAMES = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
        return {
          cells: out,
          cell: CELL, gap: GAP,
          width: cols * (CELL + GAP) - GAP,
          height: 7 * (CELL + GAP) - GAP + LABEL_H,
          labelY: 7 * (CELL + GAP) - GAP + 10,
          monthLabels: monthLabels.map(ml => ({ text: MONTH_NAMES[ml.month], x: ml.x + CELL / 2 }))
        };
      }, [tick]);

      const onEnter = (cell) => (e) => {
        const rect = e.target.getBoundingClientRect();
        setHover({ cell, x: rect.left + rect.width / 2, y: rect.top });
      };
      const onMove = (cell) => (e) => {
        const rect = e.target.getBoundingClientRect();
        setHover({ cell, x: rect.left + rect.width / 2, y: rect.top });
      };
      const onLeave = () => setHover(null);

      const tooltip = hover
        ? jsxrt.jsx("span", {
            className: "dus-tooltip",
            "data-side": "top",
            style: { left: hover.x + "px", top: hover.y - 8 + "px" },
            role: "tooltip",
            children: hover.cell.key + " · " + formatTokens(hover.cell.v) + " tokens"
          })
        : null;

      return jsxrt.jsxs("div", { children: [
        jsxrt.jsx("svg", {
          className: "dus-heatmap-svg",
          viewBox: "0 0 " + view.width + " " + view.height,
          role: "img",
          "aria-label": "yearly token usage heatmap",
          children: [
            view.cells.map((c, i) =>
              jsxrt.jsx("rect", {
                x: Math.floor(i / 7) * (view.cell + view.gap),
                y: (i % 7) * (view.cell + view.gap),
                width: view.cell, height: view.cell, rx: 2,
                className: "dus-hcell" + (c.level > 0 ? " l" + c.level : ""),
                onMouseEnter: onEnter(c),
                onMouseMove: onMove(c),
                onMouseLeave: onLeave
              }, c.key)
            ),
            view.monthLabels.map((ml, i) =>
              jsxrt.jsx("text", {
                x: ml.x, y: view.labelY,
                fontSize: 9, textAnchor: "start",
                fill: "currentColor", opacity: .55,
                children: ml.text
              }, "m" + i)
            )
          ]
        }),
        tooltip
      ] });
    }

    /**
     * 近 N 天分模型用量曲线图（SVG 折线）。
     * 悬停时显示当日各模型具体用量，tooltip 与 dsh 原生 Tooltip 视觉一致。
     */
    function ModelChart({ rangeDays, tick }) {
      const [hover, setHover] = react.useState(null); // { idx, clientX, clientY } | null
      const view = react.useMemo(() => {
        const days = [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (let i = rangeDays - 1; i >= 0; i--) {
          const k = dayKeyOf(today.getTime() - i * 86400000);
          days.push({ key: k, d: ledger.days[k] || emptyDay() });
        }
        const totalsByModel = {};
        for (const { d } of days) for (const m of Object.keys(d.byModel)) totalsByModel[m] = (totalsByModel[m] || 0) + d.byModel[m];
        const ranked = Object.keys(totalsByModel).sort((a, b) => totalsByModel[b] - totalsByModel[a]);
        const top = ranked.slice(0, 6);
        const rest = ranked.slice(6);
        const series = rest.length ? top.concat(["其他"]) : top;
        const colorOf = (m) => PALETTE[series.indexOf(m) % PALETTE.length];
        const rows = days.map(({ key, d }) => {
          const parts = [];
          for (const m of top) if (d.byModel[m]) parts.push({ m, v: d.byModel[m] });
          if (rest.length) {
            let rv = 0; for (const m of rest) rv += d.byModel[m] || 0;
            if (rv > 0) parts.push({ m: "其他", v: rv });
          }
          // 每条序列在该日的值（无则 0，折线保持连续）
          const bySeries = {};
          for (const s of series) {
            bySeries[s] = s === "其他"
              ? rest.reduce((acc, m) => acc + (d.byModel[m] || 0), 0)
              : (d.byModel[s] || 0);
          }
          return { key, parts, bySeries };
        });
        const maxY = Math.max(1, ...rows.map((r) => r.parts.reduce((s, p) => s + p.v, 0)));
        return { rows, series, colorOf, maxY };
      }, [rangeDays, tick]);

      const W = 760, H = 210, PAD_L = 46, PAD_B = 20, PAD_T = 8;
      const innerW = W - PAD_L - 8, innerH = H - PAD_B - PAD_T;
      const step = innerW / view.rows.length;
      const xOf = (idx) => PAD_L + idx * step + step / 2;
      const yOf = (v) => PAD_T + innerH - (v / view.maxY) * innerH;
      const yTicks = [0, 0.5, 1];

      const onMove = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const sx = (e.clientX - rect.left) * (W / rect.width);   // 屏幕坐标 → viewBox 坐标
        let idx = Math.round((sx - PAD_L - step / 2) / step);
        idx = Math.max(0, Math.min(view.rows.length - 1, idx));
        setHover({ idx, clientX: e.clientX, clientY: e.clientY });
      };
      const onLeave = () => setHover(null);

      const hoverRow = hover ? view.rows[hover.idx] : null;
      const tooltip = hoverRow
        ? jsxrt.jsx("span", {
            className: "dus-tooltip",
            "data-side": "top",
            style: { left: hover.clientX + "px", top: hover.clientY - 8 + "px" },
            role: "tooltip",
            children: hoverRow.key + "\n" + (hoverRow.parts.length
              ? hoverRow.parts.map((p) => p.m + "  " + formatTokens(p.v) + " tokens").join("\n")
              : "无用量")
          })
        : null;

      return jsxrt.jsxs("div", { children: [
        jsxrt.jsx("svg", { className: "dus-chart-svg", viewBox: "0 0 " + W + " " + H, role: "img",
          "aria-label": "per-model token usage",
          onMouseMove: onMove,
          onMouseLeave: onLeave,
          children: [
          yTicks.map((f, i) => jsxrt.jsxs("g", { children: [
            jsxrt.jsx("line", { x1: PAD_L, x2: W - 8, y1: PAD_T + innerH * (1 - f), y2: PAD_T + innerH * (1 - f),
              stroke: "rgba(127,127,127,.25)", strokeDasharray: f === 0 ? "" : "3 4" }),
            jsxrt.jsx("text", { x: PAD_L - 6, y: PAD_T + innerH * (1 - f) + 3, fontSize: 9,
              textAnchor: "end", fill: "currentColor", opacity: .55, children: formatTokens(view.maxY * f) })
          ] }, "t" + i)),
          hover ? jsxrt.jsx("line", { x1: xOf(hover.idx), x2: xOf(hover.idx), y1: PAD_T, y2: PAD_T + innerH,
            stroke: "currentColor", opacity: .25, strokeDasharray: "3 3" }, "guide") : null,
          view.series.map((m) =>
            jsxrt.jsx("polyline", { points: view.rows.map((r, idx) => xOf(idx) + "," + yOf(r.bySeries[m])).join(" "),
              fill: "none", stroke: view.colorOf(m), strokeWidth: 1.6,
              strokeLinejoin: "round", strokeLinecap: "round" }, "line-" + m)),
          view.series.map((m) => jsxrt.jsx("g", { children: view.rows.map((r, idx) =>
            r.bySeries[m] > 0 ? jsxrt.jsx("circle", { cx: xOf(idx), cy: yOf(r.bySeries[m]), r: 2,
              fill: view.colorOf(m) }, idx) : null
          ) }, "dots-" + m)),
          view.rows.filter((_r, i) => i % Math.ceil(view.rows.length / 6) === 0 || i === view.rows.length - 1)
            .map((r) => jsxrt.jsx("text", { x: xOf(view.rows.indexOf(r)), y: H - 6,
              fontSize: 9, textAnchor: "middle", fill: "currentColor", opacity: .55,
              children: r.key.slice(5) }, "x" + r.key))
        ] }),
        jsxrt.jsx("div", { className: "dus-model-legend", children: view.series.map((m) =>
          jsxrt.jsxs("span", { children: [
            jsxrt.jsx("span", { className: "dus-dot", style: { background: view.colorOf(m) } }),
            m
          ] }, m))
        }),
        tooltip
      ] });
    }

    function UsageSection() {
      const [tick, setTick] = react.useState(0);
      const [range, setRange] = react.useState(30);
      const [confirmClear, setConfirmClear] = react.useState(false);
      react.useEffect(() => {
        const onChange = () => setTick((t) => t + 1);
        window.addEventListener("storage", onChange);
        window.addEventListener("dsh-usage-stats:changed", onChange);
        const iv = setInterval(onChange, 60000);
        return () => {
          window.removeEventListener("storage", onChange);
          window.removeEventListener("dsh-usage-stats:changed", onChange);
          clearInterval(iv);
        };
      }, []);
      const stats = react.useMemo(() => computeStats(), [tick]);
      const refresh = () => { ledger = loadLedger(); setTick((t) => t + 1); };

      return jsxrt.jsxs("div", { className: "dus-wrap", children: [
        jsxrt.jsxs("div", { className: "dus-toolbar", children: [
          jsxrt.jsx("span", { className: "dus-muted", children: "数据保存在浏览器本地，随会话使用自动累计；打开历史会话可回填其用量。" }),
          jsxrt.jsx("span", { style: { flex: 1 } }),
          confirmClear
            ? jsxrt.jsxs(react.Fragment, { children: [
                jsxrt.jsx("button", { className: "dus-btn danger", onClick: () => {
                  ledger = emptyLedger(); saveLedger(); setConfirmClear(false); setTick((t) => t + 1);
                }, children: "确认清空" }),
                jsxrt.jsx("button", { className: "dus-btn", onClick: () => setConfirmClear(false), children: "取消" })
              ] })
            : jsxrt.jsx("button", { className: "dus-btn", onClick: () => setConfirmClear(true), children: "清空数据" })
        ] }),

        jsxrt.jsx("div", { className: "dus-cards-row", children: [
          jsxrt.jsx(StatCard, { label: "累计 Tokens", value: formatTokens(stats.total),
            sub: stats.activeDays + " 个活跃天" }),
          jsxrt.jsx(StatCard, { label: "单日峰值", value: formatTokens(stats.peak), sub: stats.peakDay || undefined }),
          jsxrt.jsx(StatCard, { label: "今日", value: formatTokens(stats.today) })
        ] }),
        jsxrt.jsx("div", { className: "dus-cards-row", children: [
          jsxrt.jsx(StatCard, { label: "当前连续天数", value: String(stats.currentStreak), sub: "天" }),
          jsxrt.jsx(StatCard, { label: "最长连续天数", value: String(stats.longestStreak), sub: "天" })
        ] }),

        jsxrt.jsx("div", { className: "dus-section-title", children: "近一年用量热力图" }),
        jsxrt.jsx(YearHeatmap, { tick }),
        jsxrt.jsxs("div", { className: "dus-legend", children: [
          "少", jsxrt.jsx("span", { className: "dus-cell" }), jsxrt.jsx("span", { className: "dus-cell l1" }),
          jsxrt.jsx("span", { className: "dus-cell l2" }), jsxrt.jsx("span", { className: "dus-cell l3" }),
          jsxrt.jsx("span", { className: "dus-cell l4" }), "多"
        ] }),

        jsxrt.jsxs("div", { className: "dus-section-title", style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          "各模型用量（按天）",
          jsxrt.jsx("span", { style: { flex: 1 } }),
          [7, 30, 90].map((d) => jsxrt.jsx("button", {
            className: "dus-btn" + (range === d ? " on" : ""), onClick: () => setRange(d),
            children: "近" + d + "天"
          }, "r" + d))
        ] }),
        stats.total > 0
          ? jsxrt.jsx(ModelChart, { rangeDays: range, tick })
          : jsxrt.jsx("div", { className: "dus-empty", children: "暂无数据 —— 开始对话后这里会出现统计图表" }),

        jsxrt.jsxs("div", { className: "dus-note", children: [
          "· 口径：每条 assistant 回复的 provider 上报用量（input + output + cache 读 + cache 写）；reasoning tokens 已含在 output 中，不重复计。",
          jsxrt.jsx("br", {}),
          "· 模型归属取该次请求日志记录的 source.model；同一会话中途切换模型时按各自请求分别计入。",
          jsxrt.jsx("br", {}),
          "· 本页由 dsh-usage-stats 插件提供，数据仅存于本机浏览器 localStorage。"
        ] })
      ] });
    }

    // ==========================================================================
    // 5.5 设置导航图标替换：壳里 navIcon() 按 section id 写死映射，未知 id 一律
    //     兜底齿轮。这里用 MutationObserver 找到标签为「使用统计」的导航按钮，
    //     把其中的齿轮 SVG 换成自绘柱状图（与图元库同规格：viewBox 16、
    //     fill=currentColor），已替换的节点打 data 标记避免重复处理。
    // ==========================================================================
    const NAV_LABEL = "使用统计";

    function chartIconSvg() {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "none");
      svg.setAttribute("aria-hidden", "true");
      // 三根上升柱 + 一条基线，底部对齐，圆角 1，风格贴近 outline 家族
      const bars = [
        { x: 2.25, y: 8.75, h: 5.25 },
        { x: 6.75, y: 5.25, h: 8.75 },
        { x: 11.25, y: 1.75, h: 12.25 }
      ];
      for (const b of bars) {
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", String(b.x));
        r.setAttribute("y", String(b.y));
        r.setAttribute("width", "2.5");
        r.setAttribute("height", String(b.h));
        r.setAttribute("rx", "1");
        r.setAttribute("fill", "currentColor");
        svg.appendChild(r);
      }
      const base = document.createElementNS(NS, "path");
      base.setAttribute("d", "M1.5 15H14.5");
      base.setAttribute("stroke", "currentColor");
      base.setAttribute("stroke-width", "1.4");
      base.setAttribute("stroke-linecap", "round");
      base.setAttribute("opacity", "0.55");
      svg.appendChild(base);
      svg.dataset.dusNavIcon = "1";
      return svg;
    }

    function sweepSettingsNav() {
      if (typeof document === "undefined") return;
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const labelSpan = btn.querySelector(":scope > span");
        if (!labelSpan || labelSpan.textContent.trim() !== NAV_LABEL) continue;
        if (!btn.querySelector(":scope > svg")) continue;
        if (btn.querySelector('svg[data-dus-nav-icon="1"]')) continue; // 已是图表图标
        const old = btn.querySelector(":scope > svg:not([data-dus-nav-icon])");
        if (old) btn.replaceChild(chartIconSvg(), old);
      }
    }

    let navObserver = null;
    function installNavIconObserver() {
      if (typeof document === "undefined" || navObserver !== null) return;
      sweepSettingsNav();
      let queued = false;
      const schedule = () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; sweepSettingsNav(); });
      };
      navObserver = new MutationObserver(schedule);
      navObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ==========================================================================
    // 6. 插件入口：两个槽位
    // ==========================================================================
    const inject = ["slots"];

    function apply(ctx) {
      // 采集器：任何会话打开即后台累计（渲染 null，不占视觉）
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          { name: "conversation.composer.dock", id: "dsh-usage-collector", order: 900 },
          UsageCollector
        )
      );
      // 「使用统计」设置页
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          { name: "settings.section", id: "usage-stats", order: 60, label: "使用统计" },
          UsageSection
        )
      );

      installNavIconObserver();
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.UsageSection = UsageSection;
    exports.UsageCollector = UsageCollector;

    // 测试钩子：Node 端模拟环境验证账本逻辑用；不影响浏览器行为
    exports.__test = { foldMessageEvent, computeStats, loadLedger, emptyLedger, scheduleReconcile, maxAssistantSeq };

    return module.exports;
  }
});
