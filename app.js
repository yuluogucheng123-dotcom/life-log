/* =====================================================================
 * 生活记录 · 界面逻辑
 * ===================================================================== */

/* ---------- 全局状态 ---------- */
const state = {
  entries: loadEntries(),
  settings: loadSettings(),
  page: 'today',
  date: todayYmd(),          // 当前查看的日期
  activeKind: 'expense',     // 当前录入 tab
  range: 'week',             // week | month | all
  rangeAnchor: todayYmd(),   // 用于计算显示哪一周/哪一月
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* 安全绑定：元素不存在时跳过，避免整脚本中断导致白屏 */
function on(sel, event, handler) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (el) el.addEventListener(event, handler);
  return el;
}

/* 安全写文本 / 禁用态 */
function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}
function setDisabled(sel, flag) {
  const el = $(sel);
  if (el) el.disabled = !!flag;
}

/* ---------- 轻提示 ---------- */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  // 重播动画
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1900);
}

/* ---------- 记录成功反馈 ---------- */
function celebrate(el, kind) {
  if (!el) return;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');

  // 轻微震动（支持的设备）
  if (navigator.vibrate) {
    try { navigator.vibrate(12); } catch (e) {}
  }
}

/* =========================================================
 * 页面切换
 * ========================================================= */
function switchPage(page) {
  state.page = page;
  $$('.page').forEach((el) => el.classList.toggle('hidden', el.dataset.page !== page));
  $$('.tab').forEach((el) => el.classList.toggle('active', el.dataset.nav === page));
  const title = $('#pageTitle');
  if (title) title.textContent = page === 'today' ? '今天' : '总结';
  window.scrollTo(0, 0);
  render();
}

/* =========================================================
 * 渲染 · 日期栏
 * ========================================================= */
function renderDateStrip() {
  const d = parseYmd(state.date);
  const isToday = state.date === todayYmd();
  setText('#dateMain', isToday ? '今天' : `${d.getMonth() + 1} 月 ${d.getDate()} 日`);
  setText('#dateSub', `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`);
  // 不允许翻到未来
  setDisabled('#nextDay', state.date >= todayYmd());
}

/* =========================================================
 * 渲染 · 当天概览卡片
 * ========================================================= */
function renderDayStats() {
  const dayEntries = entriesOn(state.entries, state.date);
  const box = $('#dayStats');
  if (!box) return;

  const parts = KIND_ORDER.map((kind) => {
    const cfg = KINDS[kind];
    const items = dayEntries.filter((e) => e.kind === kind);
    const total = sumValue(items);
    const text = kind === 'expense' ? fmtMoney(total) : fmtDuration(total);
    return `
      <div class="stat-card kind-${kind}">
        <div class="stat-ico">${cfg.icon}</div>
        <div class="stat-val">${items.length ? text : '—'}</div>
        <div class="stat-label">${cfg.label}${items.length ? ` · ${items.length}条` : ''}</div>
      </div>`;
  });
  box.innerHTML = parts.join('');
}

/* =========================================================
 * 渲染 · 当天记录列表
 * ========================================================= */
function renderDayList() {
  const dayEntries = entriesOn(state.entries, state.date)
    .sort((a, b) => b.ts - a.ts);
  const box = $('#dayList');
  if (!box) return;

  if (!dayEntries.length) {
    const isToday = state.date === todayYmd();
    box.innerHTML = `
      <div class="empty-block">
        <div class="empty-ico">${isToday ? '📝' : '🗓'}</div>
        <div class="empty-title">${isToday ? '今天还没有记录' : '这天没有记录'}</div>
        <div class="empty-desc">${isToday
          ? '在上面选一个分类，填上金额或时长，几秒就好'
          : '可以用顶部的 ‹ › 切换日期'}</div>
      </div>`;
    return;
  }

  box.innerHTML = dayEntries.map((e) => {
    const cfg = KINDS[e.kind] || KINDS.expense;
    const valText = e.kind === 'expense' ? fmtMoney(e.value) : fmtDuration(e.value);
    const sub = [e.category, e.note].filter(Boolean).join(' · ');
    return `
      <div class="item" data-id="${e.id}">
        <div class="item-ico kind-${e.kind}">${cfg.icon}</div>
        <div class="item-main">
          <div class="item-title">${escapeHtml(sub || cfg.label)}</div>
          <div class="item-sub">${cfg.label}</div>
        </div>
        <div class="item-val">${valText}</div>
        <button class="del-btn" data-del="${e.id}" aria-label="删除">✕</button>
      </div>`;
  }).join('');
}

/* =========================================================
 * 渲染 · 总结页（周报 / 月报 / 全部）
 * ========================================================= */
function getRangeBounds() {
  const anchor = state.rangeAnchor;
  if (state.range === 'week') {
    const start = weekStart(anchor);
    return { start, end: addDays(start, 6) };
  }
  if (state.range === 'month') {
    const d = parseYmd(anchor);
    const start = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
    const end = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { start, end };
  }
  // 全部：从最早一条记录到今天
  if (!state.entries.length) return { start: todayYmd(), end: todayYmd() };
  const dates = state.entries.map((e) => e.date).sort();
  return { start: dates[0], end: todayYmd() };
}

function renderReportHeader(bounds) {
  const s = parseYmd(bounds.start);
  const e = parseYmd(bounds.end);

  if (state.range === 'all') {
    setText('#rangeMain', '全部记录');
    setText('#rangeSub', `${bounds.start} 至 ${bounds.end}`);
    setDisabled('#prevRange', true);
    setDisabled('#nextRange', true);
    return;
  }

  if (state.range === 'week') {
    const isThisWeek = isSameWeek(bounds.start, todayYmd());
    setText('#rangeMain', isThisWeek ? '本周' : '周报');
    setText('#rangeSub', `${s.getMonth() + 1}/${s.getDate()} – ${e.getMonth() + 1}/${e.getDate()}`);
  } else {
    const isThisMonth = isSameMonth(bounds.start, todayYmd());
    setText('#rangeMain', isThisMonth ? '本月' : '月报');
    setText('#rangeSub', `${s.getFullYear()} 年 ${s.getMonth() + 1} 月`);
  }

  // 本周 / 本月：上一期始终可用
  setDisabled('#prevRange', false);

  // 未来期间禁用「下一期」
  const nextAnchor = state.range === 'week'
    ? addDays(bounds.end, 1)
    : ymd(new Date(e.getFullYear(), e.getMonth() + 1, 1));
  const canGoNext = state.range === 'week'
    ? weekStart(nextAnchor) <= weekStart(todayYmd())
    : nextAnchor.slice(0, 7) <= todayYmd().slice(0, 7);
  setDisabled('#nextRange', !canGoNext);
}

// 本期速览：三类并排 + 连续天数
function renderSummaryRow(entries, days, bounds) {
  const exp = entries.filter((e) => e.kind === 'expense');
  const study = entries.filter((e) => e.kind === 'study');
  const fit = entries.filter((e) => e.kind === 'fitness');

  const streak = computeStreak(state.entries);

  const cell = (kind, cfg, items, total) => {
    const val = items.length
      ? (kind === 'expense' ? fmtMoney(total) : fmtDuration(total))
      : '—';
    return `
      <div class="sum-cell kind-${kind}">
        <div class="sum-ico">${cfg.icon}</div>
        <div class="sum-val">${val}</div>
        <div class="sum-label">${cfg.label}${items.length ? ` · ${items.length} 条` : ''}</div>
      </div>`;
  };

  return `
    <div class="sum-row">
      ${cell('expense', KINDS.expense, exp, sumValue(exp))}
      ${cell('study', KINDS.study, study, sumValue(study))}
      ${cell('fitness', KINDS.fitness, fit, sumValue(fit))}
    </div>
    <div class="streak-bar">
      <div class="streak-left">
        <span class="streak-fire">${streak.current > 0 ? '🔥' : '·'}</span>
        <span class="streak-current">${streak.current}</span>
        <span class="streak-unit">天连续</span>
      </div>
      <div class="streak-right">
        最长 ${streak.best} 天 · 累计 ${streak.total} 天
      </div>
    </div>`;
}

function renderReport() {
  const bounds = getRangeBounds();
  renderReportHeader(bounds);

  const box = $('#reportBody');
  if (!box) return;
  const inPeriod = entriesBetween(state.entries, bounds.start, bounds.end);

  if (!inPeriod.length) {
    box.innerHTML = `
      <div class="empty">
        这一期还没有记录<br>
        <span>回到「记录」页，记下第一笔试试</span>
      </div>`;
    return;
  }

  const days = Math.max(1, Math.round(
    (parseYmd(bounds.end) - parseYmd(bounds.start)) / 86400000
  ) + 1);

  const blocks = [];

  /* ---- 一句话结论 ---- */
  const verdict = buildVerdict(inPeriod, bounds, state.range, days, state.entries);
  if (verdict) {
    blocks.push(`<div class="verdict">${escapeHtml(verdict)}</div>`);
  }

  /* ---- 本期速览：三色三栏 ---- */
  blocks.push(renderSummaryRow(inPeriod, days, bounds));

  /* ---- 洞察卡片 ---- */
  const insights = buildInsights(inPeriod, bounds, state.range, days, state.entries);
  if (insights.length) {
    blocks.push(`<h2 class="section-title">本期看点</h2>`);
    blocks.push(`<div class="insight-grid">` + insights.map((it) => `
      <div class="insight kind-${it.kind}">
        <div class="insight-top">
          <span class="insight-ico">${it.icon}</span>
          <span class="insight-title">${escapeHtml(it.title)}</span>
          ${it.delta ? deltaTag(it.delta.cur, it.delta.prev, it.delta.kind) : ''}
        </div>
        <div class="insight-val">${escapeHtml(String(it.value))}</div>
        <div class="insight-desc">${escapeHtml(it.desc || '')}</div>
      </div>`).join('') + `</div>`);
  }

  blocks.push(`<h2 class="section-title">分类明细</h2>`);

  /* ---- 支出 ---- */
  const exp = inPeriod.filter((e) => e.kind === 'expense');
  if (exp.length) {
    const total = sumValue(exp);
    const groups = groupByCategory(exp);
    const max = groups[0]?.total || 1;
    const dailyAvg = total / days;

    // 预算进度（仅本月/本周有总预算概念时显示当月）
    let budgetHtml = '';
    const budget = Number(state.settings.budget) || 0;
    if (budget > 0 && state.range === 'month') {
      const pct = Math.min(100, (total / budget) * 100);
      const over = total > budget;
      budgetHtml = `
        <div class="budget">
          <div class="budget-bar"><i style="width:${pct}%;background:${over ? 'var(--danger)' : 'var(--accent)'}"></i></div>
          <div class="budget-text">预算 ${fmtMoney(budget)} · 已用 ${pct.toFixed(0)}%${over ? ` · 超支 ${fmtMoney(total - budget)}` : ` · 剩余 ${fmtMoney(budget - total)}`}</div>
        </div>`;
    }

    const trend = groupByDay(exp, bounds.start, bounds.end);
    const tMax = Math.max(...trend.map((t) => t.total), 1);

    blocks.push(`
      <div class="report-card">
        <div class="report-head">
          <h3>💸 支出</h3>
          <div class="report-total">${fmtMoney(total)}</div>
        </div>
        <div class="report-meta">共 ${exp.length} 笔 · 日均 ${fmtMoney(dailyAvg)}</div>
        ${budgetHtml}
        ${renderBars(groups, max, 'expense')}
        ${trend.length > 1 ? renderTrend(trend, tMax) : ''}
      </div>`);
  }

  /* ---- 学习 & 健身 ---- */
  for (const kind of ['study', 'fitness']) {
    const items = inPeriod.filter((e) => e.kind === kind);
    if (!items.length) continue;
    const cfg = KINDS[kind];
    const total = sumValue(items);
    const groups = groupByCategory(items);
    const max = groups[0]?.total || 1;
    const goal = kind === 'study'
      ? Number(state.settings.studyGoal) || 0
      : Number(state.settings.fitGoal) || 0;

    // 目标是「每周」的，按周折算
    let goalHtml = '';
    if (goal > 0) {
      const weeks = days / 7;
      const target = state.range === 'week' ? goal : goal * weeks;
      const pct = Math.min(100, (total / target) * 100);
      goalHtml = `
        <div class="budget">
          <div class="budget-bar"><i style="width:${pct}%;background:var(--accent-2)"></i></div>
          <div class="budget-text">周目标 ${fmtDuration(goal)} · 本期完成 ${pct.toFixed(0)}%</div>
        </div>`;
    }

    const activeDays = new Set(items.map((e) => e.date)).size;
    const trend = groupByDay(items, bounds.start, bounds.end);
    const tMax = Math.max(...trend.map((t) => t.total), 1);

    blocks.push(`
      <div class="report-card">
        <div class="report-head">
          <h3>${cfg.icon} ${cfg.label}</h3>
          <div class="report-total">${fmtDuration(total)}</div>
        </div>
        <div class="report-meta">共 ${items.length} 次 · 坚持 ${activeDays} 天 · 日均 ${fmtDuration(total / days)}</div>
        ${goalHtml}
        ${renderBars(groups, max, kind)}
        ${trend.length > 1 ? renderTrend(trend, tMax) : ''}
      </div>`);
  }

  /* ---- 页脚：数据规模 ---- */
  blocks.push(`
    <p class="report-foot">
      本期共 ${inPeriod.length} 条记录 · 覆盖 ${new Set(inPeriod.map((e) => e.date)).size} 天
    </p>`);

  box.innerHTML = blocks.join('');
}

// 分类横向条
function renderBars(groups, max, kind) {
  const cfg = KINDS[kind];
  const isMoney = kind === 'expense';
  return `<div class="bars">` + groups.map((g) => {
    const pct = (g.total / max) * 100;
    const val = isMoney ? fmtMoney(g.total) : fmtDuration(g.total);
    return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(g.category)}</div>
        <div class="bar-track"><i class="bar-fill kind-${kind}" style="width:${pct}%"></i></div>
        <div class="bar-val">${val}</div>
      </div>`;
  }).join('') + `</div>`;
}

// 逐日趋势柱
function renderTrend(trend, max) {
  const bars = trend.map((t) => {
    const h = t.total > 0 ? Math.max(4, (t.total / max) * 100) : 2;
    const label = t.date.slice(8);
    const cls = t.total > 0 ? 'has' : 'zero';
    return `<div class="trend-col" title="${t.date}: ${t.total}">
      <i class="${cls}" style="height:${h}%"></i><span>${label}</span>
    </div>`;
  }).join('');
  return `<div class="trend">${bars}</div>`;
}

/* ---------- 工具 ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* =========================================================
 * 主渲染
 * ========================================================= */
function render() {
  if (state.page === 'today') {
    renderDateStrip();
    renderDayStats();
    renderDayList();
  } else {
    renderReport();
  }
  updateCountInfo();
}

function updateCountInfo() {
  const el = $('#countInfo');
  if (!el) return;
  const n = state.entries.length;
  el.textContent = n ? `共 ${n} 条记录` : '还没有任何记录';
}

/* =========================================================
 * 事件绑定
 * ========================================================= */

/* ---- 底部导航 ---- */
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchPage(btn.dataset.nav));
});
$('#btnSettings')?.addEventListener('click', openSettings);

/* ---- 录入 tab 切换 ---- */
$$('#entryTabs .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.activeKind = btn.dataset.kind;
    $$('#entryTabs .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $$('[data-form]').forEach((f) => f.classList.toggle('hidden', f.dataset.form !== state.activeKind));
  });
});

/* ---- 分类 chip 选择 ---- */
$$('.chips').forEach((box) => {
  const form = box.closest('form');
  box.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    const wasActive = chip.classList.contains('active');
    box.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    if (!wasActive) chip.classList.add('active');
    if (form) form.dataset.category = wasActive ? '' : chip.dataset.val;
  });
});

/* ---- 表单提交 ---- */
$$('.entry-form').forEach((form) => {
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const kind = form.dataset.form;
    const cfg = KINDS[kind];
    const raw = form.elements[cfg.field].value.trim();
    const amount = Number(raw);

    if (!raw || !isFinite(amount) || amount <= 0) {
      toast('请输入有效的' + cfg.fieldLabel);
      return;
    }

    const entry = makeEntry(
      kind,
      amount,
      form.dataset.category || cfg.categories[cfg.categories.length - 1],
      form.elements.note.value,
      state.date
    );

    state.entries.push(entry);
    saveEntries(state.entries);

    // 后台同步到云端（失败会进队列，联网后自动重试）
    if (SYNC.isSignedIn()) {
      SYNC.enqueue({ type: 'upsert', row: entryToRow(entry) });
      SYNC.flush();
    }

    // 保留分类选择，清空数值和备注，方便连续录入
    form.elements[cfg.field].value = '';
    form.elements.note.value = '';
    form.elements[cfg.field].focus();

    toast(`已记录：${cfg.label} ${kind === 'expense' ? fmtMoney(amount) : fmtDuration(amount)}`);
    render();

    // 记录成功的反馈：概览卡弹一下
    celebrate($('#dayStats')?.querySelector(`.kind-${kind}`) || $('#dayStats'));
  });
});

/* ---- 日期切换 ---- */
on('#prevDay', 'click', () => {
  state.date = addDays(state.date, -1);
  render();
});
on('#nextDay', 'click', () => {
  if (state.date >= todayYmd()) return;
  state.date = addDays(state.date, 1);
  render();
});

/* ---- 删除记录（软删除 + 入队同步） ---- */
on('#dayList', 'click', (ev) => {
  const btn = ev.target.closest('[data-del]');
  if (!btn) return;
  const id = btn.dataset.del;
  const now = Date.now();
  // 软删除：标记而非移除，避免多设备同步时被"复活"
  state.entries = state.entries.map((e) =>
    e.id === id ? { ...e, deleted: true, updatedAt: now } : e
  );
  saveEntries(state.entries);
  const gone = state.entries.find((e) => e.id === id);
  if (gone && SYNC.isSignedIn()) {
    SYNC.enqueue({ type: 'upsert', row: entryToRow(gone) });
    SYNC.flush();
  }
  toast('已删除');
  render();
});

/* ---- 总结页区间切换 ---- */
$$('#rangeTabs .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.range = btn.dataset.range;
    state.rangeAnchor = todayYmd();
    $$('#rangeTabs .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $('#reportNav')?.classList.toggle('hidden', state.range === 'all');
    render();
  });
});

on('#prevRange', 'click', () => {
  const d = parseYmd(state.rangeAnchor);
  if (state.range === 'week') {
    state.rangeAnchor = addDays(state.rangeAnchor, -7);
  } else {
    state.rangeAnchor = ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  render();
});

on('#nextRange', 'click', () => {
  const d = parseYmd(state.rangeAnchor);
  if (state.range === 'week') {
    state.rangeAnchor = addDays(state.rangeAnchor, 7);
  } else {
    state.rangeAnchor = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }
  render();
});

/* =========================================================
 * 设置面板
 * ========================================================= */
function openSettings() {
  if ($('#budgetInput')) $('#budgetInput').value = state.settings.budget || '';
  if ($('#studyGoalInput')) $('#studyGoalInput').value = state.settings.studyGoal || '';
  if ($('#fitGoalInput')) $('#fitGoalInput').value = state.settings.fitGoal || '';
  updateCountInfo();
  updateInstallHint();
  $('#settingsSheet')?.classList.remove('hidden');
}

function closeSettings() {
  // 保存目标设置
  state.settings.budget = Number($('#budgetInput')?.value) || 0;
  state.settings.studyGoal = Number($('#studyGoalInput')?.value) || 0;
  state.settings.fitGoal = Number($('#fitGoalInput')?.value) || 0;
  saveSettings(state.settings);
  if (SYNC.isSignedIn()) {
    SYNC.enqueue({ type: 'settings', row: settingsToRow(state.settings) });
    SYNC.flush();
  }
  $('#settingsSheet')?.classList.add('hidden');
  render();
}

on('#closeSettings', 'click', closeSettings);

on('#settingsSheet', 'click', (ev) => {
  if (ev.target.id === 'settingsSheet') closeSettings();
});

/* ---- 导出 ---- */
on('#btnExport', 'click', () => {
  const text = buildExportJson();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `生活记录-${todayYmd()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出文件');
});

/* ---- 复制数据（手机上好用） ---- */
on('#btnCopy', 'click', async () => {
  const text = buildExportJson();
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      // 非 HTTPS 环境的兜底方案
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const n = activeOnly(state.entries).length;
    toast(`已复制 ${n} 条记录，去粘贴到另一端吧`);
  } catch (e) {
    console.error(e);
    toast('复制失败，请改用「导出文件」');
  }
});

/* ---- 粘贴导入 ---- */
on('#btnPaste', 'click', async () => {
  let text = '';
  try {
    if (navigator.clipboard && window.isSecureContext) {
      text = await navigator.clipboard.readText();
    }
  } catch (e) {
    // 浏览器可能拒绝读取剪贴板，走手动粘贴
  }

  if (!text || !text.trim()) {
    text = prompt('把复制的数据粘贴到这里（Ctrl+V）：') || '';
  }
  if (!text.trim()) return;

  const result = mergeImport(text);
  if (result.ok) {
    toast(`导入成功：新增 ${result.added} 条，跳过 ${result.skipped} 条重复`);
    state.entries = loadEntries();
    state.settings = loadSettings();
    render();
  } else {
    toast('导入失败：' + result.error);
  }
});

/* ---- 导出内容 ---- */
function buildExportJson() {
  return JSON.stringify({
    app: 'life-log',
    version: 1,
    exportedAt: new Date().toISOString(),
    device: navigator.platform || 'unknown',
    settings: state.settings,
    entries: state.entries,   // 含软删除标记，保证合并时不会"复活"已删数据
  }, null, 2);
}

/* ---- 合并导入（按 id 去重，取更新时间较新的） ---- */
function mergeImport(text) {
  try {
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data && data.entries;
    if (!Array.isArray(incoming)) {
      return { ok: false, error: '数据格式不正确' };
    }

    const map = new Map(state.entries.map((e) => [e.id, e]));
    let added = 0, skipped = 0, updated = 0;

    for (const raw of incoming) {
      if (!raw || !raw.id || !raw.kind || !raw.date) { skipped++; continue; }

      const norm = {
        ...raw,
        value: Number(raw.value) || 0,
        deleted: !!raw.deleted,
        updatedAt: Number(raw.updatedAt) || Number(raw.ts) || Date.now(),
      };

      const mine = map.get(norm.id);
      if (!mine) {
        map.set(norm.id, norm);
        added++;
      } else if (norm.updatedAt > (mine.updatedAt || 0)) {
        map.set(norm.id, norm);   // 对方的更新，采用
        updated++;
      } else {
        skipped++;                // 本地已有且不更旧，跳过
      }
    }

    state.entries = [...map.values()];
    saveEntries(state.entries);

    if (data && data.settings) {
      const s = data.settings;
      state.settings = {
        budget: Number(s.budget) || state.settings.budget || 0,
        studyGoal: Number(s.studyGoal) || state.settings.studyGoal || 0,
        fitGoal: Number(s.fitGoal) || state.settings.fitGoal || 0,
      };
      saveSettings(state.settings);
    }

    return { ok: true, added, skipped, updated };
  } catch (e) {
    return { ok: false, error: '不是有效的数据' };
  }
}

/* ---- 导入 ---- */
on('#btnImport', 'click', () => $('#importFile')?.click());

on('#importFile', 'change', (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const result = mergeImport(String(reader.result || ''));
    if (result.ok) {
      toast(`导入成功：新增 ${result.added} 条，更新 ${result.updated || 0} 条，跳过 ${result.skipped} 条`);
      state.entries = loadEntries();
      state.settings = loadSettings();
      render();
    } else {
      toast('导入失败：' + result.error);
    }
    ev.target.value = '';
  };
  reader.readAsText(file);
});

/* ---- 清空 ---- */
on('#btnClear', 'click', () => {
  if (!confirm('确定要清空所有记录吗？此操作无法撤销。\n建议先导出备份。')) return;
  state.entries = [];
  saveEntries(state.entries);
  toast('已清空');
  render();
});

/* =========================================================
 * 认证与同步 UI
 * ========================================================= */
let authMode = 'signin';

function showAuthScreen(show) {
  $('#authScreen')?.classList.toggle('hidden', !show);
  $('#mainApp')?.classList.toggle('hidden', show);
}

function setAuthMode(mode) {
  authMode = mode;
  $$('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.auth === mode));
  const btn = $('#authSubmit');
  if (btn) btn.textContent = mode === 'signin' ? '登录' : '注册';
  const pw = $('#authPassword');
  if (pw) pw.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
  setAuthMsg('');
}

function setAuthMsg(msg, kind) {
  const el = $('#authMsg');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'auth-msg' + (kind ? ' ' + kind : '');
}

$$('.auth-tab').forEach((b) => {
  b.addEventListener('click', () => setAuthMode(b.dataset.auth));
});

on('#authSkip', 'click', () => {
  sessionStorage.setItem('lifelog.skipAuth', '1');
  showAuthScreen(false);
  render();
});

$('#authForm')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = ($('#authEmail')?.value || '').trim();
  const password = $('#authPassword')?.value || '';
  const btn = $('#authSubmit');

  if (!email || !email.includes('@')) { setAuthMsg('请输入有效的邮箱地址', 'err'); return; }
  if (password.length < 6) { setAuthMsg('密码至少 6 位', 'err'); return; }
  if (!SYNC.client) { setAuthMsg('云端未配置，请先在本地使用', 'err'); return; }

  if (btn) { btn.disabled = true; btn.textContent = authMode === 'signin' ? '登录中…' : '注册中…'; }
  setAuthMsg('');

  try {
    if (authMode === 'signin') {
      await SYNC.signIn(email, password);
      sessionStorage.removeItem('lifelog.skipAuth');
      showAuthScreen(false);
      state.entries = loadEntries();
      render();
      toast('登录成功，正在同步…');
    } else {
      const res = await SYNC.signUp(email, password);
      if (res.needConfirm) {
        setAuthMsg('注册成功！请到邮箱点击确认链接，然后回来登录。', 'ok');
        setAuthMode('signin');
      } else {
        sessionStorage.removeItem('lifelog.skipAuth');
        showAuthScreen(false);
        state.entries = loadEntries();
        render();
        toast('注册成功');
      }
    }
  } catch (e) {
    const msg = String(e.message || e);
    if (/Invalid login credentials/i.test(msg)) setAuthMsg('邮箱或密码不正确', 'err');
    else if (/already registered|already exists/i.test(msg)) setAuthMsg('该邮箱已注册，请直接登录', 'err');
    else if (/Email not confirmed/i.test(msg)) setAuthMsg('请先到邮箱点击确认链接', 'err');
    else setAuthMsg('操作失败：' + msg, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = authMode === 'signin' ? '登录' : '注册'; }
  }
});

/* ---------- 同步状态指示 ---------- */
const SYNC_LABEL = {
  unconfigured: { text: '本机', cls: 'local' },
  'signed-out': { text: '未登录', cls: 'local' },
  'signed-in': { text: '已登录', cls: 'ok' },
  syncing: { text: '同步中', cls: 'busy' },
  synced: { text: '已同步', cls: 'ok' },
  pending: { text: '待同步', cls: 'warn' },
  offline: { text: '离线', cls: 'off' },
  online: { text: '已连接', cls: 'ok' },
  error: { text: '同步异常', cls: 'err' },
};

function renderSyncStatus(payload) {
  // 同步出错时优先显示错误，避免用户被"待同步"误导
  const hasError = !!SYNC.lastError;
  const key = hasError ? 'error' : payload.status;
  const info = SYNC_LABEL[key] || { text: '本机', cls: 'local' };

  setText('#syncText', info.text);
  const dot = $('#syncDot');
  if (dot) {
    dot.className = 'sync-dot ' + info.cls;
    dot.title = hasError ? SYNC.lastError : '';
  }
  if (hasError) {
    const btn = $('#syncBtn');
    if (btn) btn.title = SYNC.lastError;
  }
  setText('#accountInfo', describeAccount());
  updateAccountButtons();
}
function describeAccount() {
  if (!SYNC.client) return '尚未配置云端。当前数据只存在这台设备上。';
  if (!SYNC.isSignedIn()) return '未登录。登录后手机和电脑的数据会自动同步。';
  const email = SYNC.user?.email || '';
  const when = SYNC.lastSyncAt
    ? new Date(SYNC.lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '尚未同步';
  const q = SYNC._queue.length;
  return `已登录：${email}\n上次同步：${when}` + (q ? `\n待同步：${q} 条` : '') +
    (SYNC.lastError ? `\n${SYNC.lastError}` : '');
}

function updateAccountButtons() {
  const signed = SYNC.isSignedIn();
  const cfg = !!SYNC.client;
  $('#btnSignIn')?.classList.toggle('hidden', signed || !cfg);
  $('#btnSignOut')?.classList.toggle('hidden', !signed);
  $('#btnSyncNow')?.classList.toggle('hidden', !signed);
}

on('#syncBtn', 'click', async () => {
  if (!SYNC.isSignedIn()) {
    openSettings();
    return;
  }
  toast('正在同步…');
  await SYNC.syncNow();
  state.entries = loadEntries();
  state.settings = loadSettings();
  render();
});

on('#btnSyncNow', 'click', async () => {
  toast('正在同步…');
  await SYNC.syncNow();
  state.entries = loadEntries();
  state.settings = loadSettings();
  render();
  toast('同步完成');
});

on('#btnSignIn', 'click', () => {
  closeSettings();
  showAuthScreen(true);
  setAuthMode('signin');
});

on('#btnSignOut', 'click', async () => {
  if (!confirm('退出登录？\n本机已记录的数据会保留，重新登录后可继续同步。')) return;
  await SYNC.signOut();
  state.entries = loadEntries();
  render();
  toast('已退出登录');
});

/* =========================================================
 * 安装引导（PWA）
 * ========================================================= */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // Chrome / Edge：拦截默认提示，改为在设置里手动触发
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = $('#btnInstall');
  if (btn) btn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  $('#btnInstall')?.classList.add('hidden');
  toast('已安装到桌面');
});

function updateInstallHint() {
  const hint = $('#installHint');
  const btn = $('#btnInstall');
  if (!hint) return;

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isStandalone) {
    hint.textContent = '已作为独立应用运行，数据保存在本机。';
    if (btn) btn.classList.add('hidden');
    return;
  }

  if (isIOS) {
    if (btn) btn.classList.add('hidden'); // iOS 不支持自动安装提示
    hint.textContent = '在 Safari 中点底部的「分享」按钮 → 选择「添加到主屏幕」，即可像 App 一样使用（全屏、无地址栏、可离线）。';
    return;
  }

  if (deferredInstallPrompt) {
    hint.textContent = '点击下方按钮，把「生活记录」安装到这台电脑，之后可以像普通程序一样打开。';
    if (btn) btn.classList.remove('hidden');
    return;
  }

  hint.textContent = '在浏览器地址栏右侧找到「安装」图标，或菜单里选择「安装此应用 / 添加到桌面」。';
  if (btn) btn.classList.add('hidden');
}

on('#btnInstall', 'click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') toast('正在安装…');
  deferredInstallPrompt = null;
  $('#btnInstall')?.classList.add('hidden');
});

/* =========================================================
 * 启动
 * ========================================================= */
async function boot() {
  // 先渲染本地数据，保证秒开（离线优先）
  try {
    render();
  } catch (e) {
    console.error('首次渲染失败', e);
  }
  updateInstallHint();

  // 再初始化云端
  SYNC.subscribe(renderSyncStatus);

  let configured = false;
  try {
    configured = await SYNC.init();
  } catch (e) {
    console.warn('云端初始化失败', e);
  }

  const skipped = sessionStorage.getItem('lifelog.skipAuth') === '1';

  if (configured) {
    // 登录成功 → 同步后的数据可能变了，刷新界面
    state.entries = loadEntries();
    state.settings = loadSettings();
    render();
    showAuthScreen(false);
  } else if (SYNC.client && !skipped) {
    // 已配置云端但未登录 → 显示登录页
    showAuthScreen(true);
    setAuthMode('signin');
  } else {
    showAuthScreen(false);
  }

  renderSyncStatus({ status: configured ? 'synced' : (SYNC.client ? 'signed-out' : 'unconfigured') });

  // 联网后自动补一次完整同步
  window.addEventListener('online', async () => {
    if (SYNC.isSignedIn()) {
      await SYNC.syncNow();
      state.entries = loadEntries();
      state.settings = loadSettings();
      render();
    }
  });
}

boot();

/* ---- Service Worker（离线可用） ---- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 注册失败', e));
  });
}
