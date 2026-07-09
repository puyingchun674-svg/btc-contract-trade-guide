/* ==========================================================================
   本文件分三部分：
   1. 标签页切换（3个固定标签页）
   2. 仓位风控计算器
   3. 交易复盘记事本（localStorage 本地存储，刷新/关闭网页不丢失）
   全部使用原生 JS，无需任何构建工具，双击 index.html 即可运行。
   ========================================================================== */

document.addEventListener("DOMContentLoaded", function () {

  /* ========================================================================
     1. 标签页切换
     ======================================================================== */
  var tabButtons = document.querySelectorAll(".tab-bar .tab-btn");
  var tabPanes = document.querySelectorAll(".tab-pane");

  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var targetId = btn.getAttribute("data-target");

      // 切换按钮高亮状态
      tabButtons.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");

      // 切换内容显示
      tabPanes.forEach(function (pane) {
        pane.classList.toggle("active", pane.id === targetId);
      });

      // 切换标签页时把内容区滚动到顶部，体验更好
      document.getElementById("tabContent").scrollTop = 0;
    });
  });


  /* ========================================================================
     1.5 风险提示"展开详情"折叠交互
     全站所有 .risk-toggle 按钮共用同一套事件委托逻辑
     ======================================================================== */
  document.body.addEventListener("click", function (e) {
    var toggleBtn = e.target.closest(".risk-toggle");
    if (!toggleBtn) return;

    var alertBox = toggleBtn.closest(".risk-alert");
    var detail = alertBox ? alertBox.querySelector(".risk-detail") : null;
    if (!detail) return;

    var isHidden = detail.hasAttribute("hidden");
    if (isHidden) {
      detail.removeAttribute("hidden");
      toggleBtn.textContent = "收起详情";
    } else {
      detail.setAttribute("hidden", "");
      toggleBtn.textContent = "展开详情";
    }
  });


  /* ========================================================================
     2. 仓位风控计算器
     ======================================================================== */

  var calcForm = document.getElementById("calcForm");
  var directionSegment = document.getElementById("directionSegment");
  var currentDirection = "long"; // 默认做多，用户可点击切换

  // 做多 / 做空 分段按钮切换
  directionSegment.addEventListener("click", function (e) {
    var btn = e.target.closest(".segment-btn");
    if (!btn) return;
    currentDirection = btn.getAttribute("data-dir");
    directionSegment.querySelectorAll(".segment-btn").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
  });

  // 校验单个数值输入：只允许非负数字（可带小数），拒绝汉字/字母/空白/负号
  // 返回 { valid, value, message }，message 为非法时的具体提示文案
  var NUMBER_ONLY_PATTERN = /^\d+(\.\d+)?$/;

  function validateNumberInput(rawValue, label, options) {
    options = options || {};
    var minValue = options.minValue !== undefined ? options.minValue : 0;
    var allowEmpty = !!options.allowEmpty;

    var trimmed = (rawValue || "").trim();

    if (trimmed === "") {
      if (allowEmpty) return { valid: true, value: null };
      return { valid: false, message: label + "不能为空，请输入数字。" };
    }

    if (!NUMBER_ONLY_PATTERN.test(trimmed)) {
      return { valid: false, message: label + "只能输入数字，不能包含汉字、字母、空格或负号。" };
    }

    var num = parseFloat(trimmed);
    if (!isFinite(num) || num < minValue) {
      return { valid: false, message: label + "必须是不小于 " + minValue + " 的数字。" };
    }

    return { valid: true, value: num };
  }

  // 数字格式化：千分位 + 固定小数位，方便阅读
  function fmt(num, digits) {
    if (digits === undefined) digits = 2;
    if (!isFinite(num)) return "--";
    return num.toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  calcForm.addEventListener("submit", function (e) {
    e.preventDefault();

    // 逐项校验：禁止汉字、空白、负数，非法输入时给出具体提示并中止计算
    var principalCheck = validateNumberInput(document.getElementById("inputPrincipal").value, "本金", { minValue: 0.00000001 });
    if (!principalCheck.valid) { alert(principalCheck.message); return; }

    var leverageCheck = validateNumberInput(document.getElementById("inputLeverage").value, "杠杆倍数", { minValue: 1 });
    if (!leverageCheck.valid) { alert(leverageCheck.message); return; }

    var entryCheck = validateNumberInput(document.getElementById("inputEntry").value, "开仓价", { minValue: 0.00000001 });
    if (!entryCheck.valid) { alert(entryCheck.message); return; }

    var currentCheck = validateNumberInput(document.getElementById("inputCurrent").value, "现价", { minValue: 0.00000001, allowEmpty: true });
    if (!currentCheck.valid) { alert(currentCheck.message); return; }

    // 校验通过后取值，变量名与计算逻辑保持不变
    var principal = principalCheck.value;
    var leverage = leverageCheck.value;
    var entry = entryCheck.value;
    var current = currentCheck.value; // 允许为 null（未填现价）

    var isLong = currentDirection === "long";

    // ---- 核心计算（简化模型：不含手续费、资金费率、维持保证金率） ----
    var positionValue = principal * leverage;              // 名义仓位价值 (USDT)
    var positionSizeBTC = positionValue / entry;            // 可开 BTC 数量

    // 爆仓价：价格反向波动 1/杠杆 时，亏损=全部保证金
    var liqPrice = isLong
      ? entry * (1 - 1 / leverage)
      : entry * (1 + 1 / leverage);

    // ---- 展示：名义仓位 / 仓位数量 / 爆仓价 ----
    document.getElementById("resPositionValue").textContent = fmt(positionValue, 2) + " USDT";
    document.getElementById("resPositionSize").textContent = fmt(positionSizeBTC, 6) + " BTC";
    document.getElementById("resLiqPrice").textContent = fmt(liqPrice, 2) + " USDT";

    // ---- 距爆仓价距离 ----
    var liqDistanceText;
    var gaugePercent; // 0~100，用于风险进度条

    if (current !== null && current > 0) {
      // 有现价：计算 现价 -> 爆仓价 的距离，以及浮动盈亏
      var distToLiqPct = isLong
        ? ((current - liqPrice) / current) * 100
        : ((liqPrice - current) / current) * 100;

      liqDistanceText = "现价距爆仓价约 " + fmt(Math.abs(distToLiqPct), 2) + "%"
        + (distToLiqPct <= 0 ? "（已触及/超过理论爆仓价！）" : "");

      // 风险进度条：0% = 开仓价位置，100% = 爆仓价位置
      var totalMove = isLong ? (entry - liqPrice) : (liqPrice - entry);
      var traveled = isLong ? (entry - current) : (current - entry);
      gaugePercent = totalMove !== 0 ? (traveled / totalMove) * 100 : 0;
      gaugePercent = Math.max(0, Math.min(100, gaugePercent));

      // 浮动盈亏 & 收益率
      var priceChangePct = (current - entry) / entry;
      var pnlUSDT = isLong
        ? positionValue * priceChangePct
        : -positionValue * priceChangePct;
      var roe = (pnlUSDT / principal) * 100;

      document.getElementById("resPnlRow").hidden = false;
      document.getElementById("resRoeRow").hidden = false;
      var pnlEl = document.getElementById("resPnlAmount");
      var roeEl = document.getElementById("resRoe");
      pnlEl.textContent = (pnlUSDT >= 0 ? "+" : "") + fmt(pnlUSDT, 2) + " USDT";
      roeEl.textContent = (roe >= 0 ? "+" : "") + fmt(roe, 2) + "%";
      pnlEl.style.color = pnlUSDT >= 0 ? "var(--long)" : "var(--short)";
      roeEl.style.color = roe >= 0 ? "var(--long)" : "var(--short)";

    } else {
      // 没有现价：距爆仓价距离就是开仓价到爆仓价的距离，恒等于 1/杠杆
      var distFromEntryPct = (1 / leverage) * 100;
      liqDistanceText = "开仓价距爆仓价约 " + fmt(distFromEntryPct, 2) + "%（即反向波动 " + fmt(distFromEntryPct, 2) + "% 触发强平）";
      gaugePercent = 0; // 还未变动，标记在开仓价位置

      document.getElementById("resPnlRow").hidden = true;
      document.getElementById("resRoeRow").hidden = true;
    }

    document.getElementById("resLiqDistance").textContent = liqDistanceText;
    document.getElementById("liqGaugeBar").style.left = gaugePercent + "%";

    // ---- 风险提示文案 ----
    var warningEl = document.getElementById("resWarning");
    var marginRatioMove = (1 / leverage) * 100;
    warningEl.textContent = "⚠ " + fmt(leverage, 0) + " 倍杠杆下，价格反向波动约 "
      + fmt(marginRatioMove, 2) + "%，本金即可能直接归零（简化计算，未计入手续费/资金费率，实际以交易所强平规则为准）。";

    document.getElementById("resultPanel").hidden = false;
  });


  /* ========================================================================
     3. 交易复盘记事本（localStorage 本地持久化）
     ======================================================================== */

  var JOURNAL_KEY = "btc_journal_entries_v1";
  var journalForm = document.getElementById("journalForm");
  var journalListEl = document.getElementById("journalList");
  var toastEl = document.getElementById("toast");
  var toastTimer = null;

  // 显示轻提示，2秒后自动消失；重复触发时先清掉上一次的计时器
  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    // 用 requestAnimationFrame 确保 hidden 移除后再加 show，触发过渡动画
    requestAnimationFrame(function () { toastEl.classList.add("show"); });

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
      setTimeout(function () { toastEl.hidden = true; }, 250); // 等淡出动画结束再隐藏
    }, 2000);
  }

  // 读取本地已保存的记录，返回数组
  function loadEntries() {
    try {
      var raw = localStorage.getItem(JOURNAL_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      // 数据异常时不让整个页面崩掉，返回空数组
      console.error("读取复盘记录失败：", err);
      return [];
    }
  }

  // 保存数组到本地
  function saveEntries(entries) {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
  }

  // 渲染记录列表（每次增删后重新渲染）
  function renderEntries() {
    var entries = loadEntries();
    journalListEl.innerHTML = "";

    if (entries.length === 0) {
      journalListEl.innerHTML = '<div class="journal-empty">还没有复盘记录，写下第一笔交易的复盘吧。</div>';
      return;
    }

    // 最新的记录显示在最前面
    entries.slice().reverse().forEach(function (entry) {
      var card = document.createElement("div");
      card.className = "journal-entry";

      card.innerHTML =
        '<div class="journal-entry-head">' +
          '<span class="journal-entry-title">' + escapeHTML(entry.symbol || "未命名交易") + '</span>' +
          '<span class="journal-entry-date">' + escapeHTML(entry.date) + '</span>' +
        '</div>' +
        buildFieldHTML("入场逻辑", entry.entryLogic) +
        buildFieldHTML("盈亏结果", entry.result) +
        buildFieldHTML("经验总结", entry.summary) +
        '<div class="journal-entry-actions">' +
          '<button type="button" class="btn-delete" data-id="' + entry.id + '">删除</button>' +
        '</div>';

      journalListEl.appendChild(card);
    });
  }

  function buildFieldHTML(label, text) {
    if (!text) return "";
    return '<div class="journal-entry-field">' +
      '<div class="journal-entry-field-label">' + label + '</div>' +
      '<div class="journal-entry-field-text">' + escapeHTML(text) + '</div>' +
    '</div>';
  }

  // 简单转义，防止用户输入内容里含有 HTML 标签破坏页面结构
  function escapeHTML(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  // 新增一条复盘记录
  journalForm.addEventListener("submit", function (e) {
    e.preventDefault();

    var symbol = document.getElementById("jSymbol").value.trim();
    var entryLogic = document.getElementById("jEntryLogic").value.trim();
    var result = document.getElementById("jResult").value.trim();
    var summary = document.getElementById("jSummary").value.trim();

    if (!entryLogic && !result && !summary) {
      alert("至少填写一项内容（入场逻辑 / 盈亏结果 / 经验总结）再保存。");
      return;
    }

    var entries = loadEntries();
    entries.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      symbol: symbol,
      entryLogic: entryLogic,
      result: result,
      summary: summary,
      date: new Date().toLocaleString("zh-CN")
    });
    saveEntries(entries);

    journalForm.reset();
    renderEntries();
    showToast("已保存复盘记录 ✅");
  });

  // 删除一条记录（事件委托，避免每次渲染都重新绑定）
  journalListEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".btn-delete");
    if (!btn) return;
    if (!confirm("确定删除这条复盘记录吗？此操作不可撤销。")) return;

    var id = btn.getAttribute("data-id");
    var entries = loadEntries().filter(function (item) { return item.id !== id; });
    saveEntries(entries);
    renderEntries();
  });

  // 初次加载时渲染已有记录
  renderEntries();

});
