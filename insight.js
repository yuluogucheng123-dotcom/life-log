/* =====================================================================
 * 生活记录 · 洞察引擎
 *
 * 把"数字"变成"结论"：
 *   - 和上一期对比，指出变化
 *   - 找出异常（超支、断档、最好/最差的一天）
 *   - 给出可执行的一句话建议
 * ===================================================================== */

/* ---------- 通用工具 ---------- */
function pctChange(cur, prev) {
  if (!prev) return cur > 0 ? null : 0;   // 上期为 0，无法算百分比
  return ((cur - prev) / prev) * 100;
}

// 把变化渲染成带颜色的小标签
function deltaTag(cur, prev, kind) {
  if (!prev && !cur) return '';
  const d = pctChange(cur, prev);
  if (d === null) return `<span class="delta new">新增</span>`;
  if (Math.abs(d) < 1) return `<span class="delta flat">持平</span>`;

  const up = d > 0;
  // 支出涨=坏，学习/健身涨=好
  const good = kind === 'expense' ? !up : up;
  const cls = good ? 'good' : 'bad';
  const arrow = up ? '↑' : '↓';
  return `<span class="delta ${cls}">${arrow} ${Math.abs(d).toFixed(0)}%</span>`;
}

/* ---------- 上一期的时间范围 ---------- */
function previousBounds(bounds, range) {
  const s = parseYmd(bounds.start);
  if (range === 'week') {
    const ps = addDays(bounds.start, -7);
    return { start: ps, end: addDays(ps, 6) };
  }
  if (range === 'month') {
    const ps = ymd(new Date(s.getFullYear(), s.getMonth() - 1, 1));
    const pe = ymd(new Date(s.getFullYear(), s.getMonth(), 0));
    return { start: ps, end: pe };
  }
  return null;
}

/* ---------- 主入口：生成洞察 ----------
 * entries  本期数据
 * bounds   本期范围
 * range    week | month | all
 * days     本期天数
 * allData  全量数据（用于和上一期对比；不传则退回用 entries）
 */
function buildInsights(entries, bounds, range, days, allData) {
  const out = [];
  const prev = previousBounds(bounds, range);
  const full = Array.isArray(allData) && allData.length ? allData : entries;
  const prevEntries = prev ? entriesBetween(full, prev.start, prev.end) : [];

  /* ===== 支出洞察 ===== */
  const exp = entries.filter((e) => e.kind === 'expense');
  const prevExp = prevEntries.filter((e) => e.kind === 'expense');

  if (exp.length) {
    const total = sumValue(exp);

    // 1. 主要开销方向（最值得先说的）
    const cats = groupByCategory(exp);
    if (cats.length && total > 0) {
      const top = cats[0];
      const share = (top.total / total) * 100;
      out.push({
        kind: 'expense',
        icon: '🎯',
        title: '主要开销',
        value: top.category,
        desc: share >= 99
          ? `本期只花了 ${fmtMoney(top.total)}`
          : `占 ${share.toFixed(0)}%，共 ${fmtMoney(top.total)}（${top.count} 笔）`,
      });
    }

    // 2. 最大一笔（与"花得最多的一天"合并，避免重复）
    const biggest = exp.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a));
    const byDayAll = groupByDay(exp, bounds.start, bounds.end).filter((d) => d.total > 0);
    const sameDay = byDayAll.filter((d) => d.total === Number(biggest.value)).length === byDayAll.length;
    out.push({
      kind: 'expense',
      icon: '🔺',
      title: '最大一笔',
      value: fmtMoney(biggest.value),
      desc: `${biggest.category}${biggest.note ? ' · ' + biggest.note : ''}（${biggest.date.slice(5)}）`,
    });

    // 3. 与上期对比（用 delta 标签 + 文字说明）
    if (prev) {
      const prevTotal = sumValue(prevExp);
      if (prevTotal > 0) {
        const diff = total - prevTotal;
        out.push({
          kind: 'expense',
          icon: diff > 0 ? '📈' : '📉',
          title: '比上期',
          value: (diff > 0 ? '多花 ' : '省下 ') + fmtMoney(Math.abs(diff)),
          desc: `上期 ${fmtMoney(prevTotal)} → 本期 ${fmtMoney(total)}`,
          delta: { cur: total, prev: prevTotal, kind: 'expense' },
        });
      }
    }

    // 4. 花得最多的一天（仅当不是"只有一笔"的情况，避免与最大一笔重复）
    const byDay = byDayAll;
    if (byDay.length > 1) {
      const peak = byDay.reduce((a, b) => (b.total > a.total ? b : a));
      const d = parseYmd(peak.date);
      out.push({
        kind: 'expense',
        icon: '📅',
        title: '花得最多的一天',
        value: fmtMoney(peak.total),
        desc: `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEKDAYS[d.getDay()]}，全天共 ${exp.filter(e => e.date === peak.date).length} 笔`,
      });
    }

    // 5. 日均
    out.push({
      kind: 'expense',
      icon: '📊',
      title: '日均支出',
      value: fmtMoney(total / days),
      desc: `本${range === 'week' ? '周' : range === 'month' ? '月' : '期'}共 ${exp.length} 笔，合计 ${fmtMoney(total)}`,
    });
  }

  /* ===== 学习洞察 ===== */
  const study = entries.filter((e) => e.kind === 'study');
  const prevStudy = prevEntries.filter((e) => e.kind === 'study');

  if (study.length) {
    const total = sumValue(study);

    // 主力方向
    const cats = groupByCategory(study);
    if (cats.length) {
      const top = cats[0];
      out.push({
        kind: 'study',
        icon: '📖',
        title: '投入最多',
        value: top.category,
        desc: `${fmtDuration(top.total)}（${top.count} 次）`,
      });
    }

    // 与上期对比
    if (prev && prevStudy.length) {
      const diff = total - sumValue(prevStudy);
      out.push({
        kind: 'study',
        icon: diff >= 0 ? '📈' : '📉',
        title: '比上期',
        value: (diff > 0 ? '+' : '') + fmtDuration(Math.abs(diff)),
        desc: diff >= 0 ? '保持住了' : '有所减少',
        delta: { cur: total, prev: sumValue(prevStudy), kind: 'study' },
      });
    }

    // 最长的一次
    const longest = study.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a));
    out.push({
      kind: 'study',
      icon: '⏱',
      title: '最长一次',
      value: fmtDuration(longest.value),
      desc: `${longest.category}${longest.note ? ' · ' + longest.note : ''}`,
    });

    // 活跃天数
    const activeDays = new Set(study.map((e) => e.date)).size;
    out.push({
      kind: 'study',
      icon: '🔥',
      title: '学习天数',
      value: activeDays + ' 天',
      desc: days > 1 ? `本期 ${days} 天中，坚持率 ${((activeDays / days) * 100).toFixed(0)}%` : '继续保持',
    });
  }

  /* ===== 健身洞察 ===== */
  const fit = entries.filter((e) => e.kind === 'fitness');
  const prevFit = prevEntries.filter((e) => e.kind === 'fitness');

  if (fit.length) {
    const total = sumValue(fit);

    const cats = groupByCategory(fit);
    if (cats.length) {
      const top = cats[0];
      out.push({
        kind: 'fitness',
        icon: '💪',
        title: '最常做的',
        value: top.category,
        desc: `${top.count} 次，共 ${fmtDuration(top.total)}`,
      });
    }

    if (prev && prevFit.length) {
      const diff = total - sumValue(prevFit);
      out.push({
        kind: 'fitness',
        icon: diff >= 0 ? '📈' : '📉',
        title: '比上期',
        value: (diff > 0 ? '+' : '') + fmtDuration(Math.abs(diff)),
        desc: diff >= 0 ? '练得更多了' : '稍微松懈了',
        delta: { cur: total, prev: sumValue(prevFit), kind: 'fitness' },
      });
    }

    const activeDays = new Set(fit.map((e) => e.date)).size;
    out.push({
      kind: 'fitness',
      icon: '🏅',
      title: '健身天数',
      value: activeDays + ' 天',
      desc: `平均每次 ${fmtDuration(total / fit.length)}`,
    });
  }

  return out;
}

/* ---------- 生成一句话总结 ---------- */
function buildVerdict(entries, bounds, range, days, allData) {
  const exp = entries.filter((e) => e.kind === 'expense');
  const study = entries.filter((e) => e.kind === 'study');
  const fit = entries.filter((e) => e.kind === 'fitness');
  const prev = previousBounds(bounds, range);
  const full = Array.isArray(allData) && allData.length ? allData : entries;
  const prevEntries = prev ? entriesBetween(full, prev.start, prev.end) : [];

  const total = sumValue(exp);
  const budget = Number(state.settings.budget) || 0;
  const lines = [];

  /* 支出（优先级最高——钱是最容易失控的） */
  if (exp.length) {
    if (budget > 0) {
      // 月报用月预算；周报/全部按天数折算成对应预算
      const target = range === 'month' ? budget : budget * (days / 30);
      const used = (total / target) * 100;
      const label = range === 'month' ? '本月' : '本期';
      if (used >= 100) {
        lines.push(`${label}已超预算 ${fmtMoney(total - target)}，接下来要收着点。`);
      } else if (used >= 80) {
        lines.push(`${label}预算已用 ${used.toFixed(0)}%，注意控制。`);
      } else if (used <= 60) {
        lines.push(`${label}预算只用了 ${used.toFixed(0)}%，节奏很健康。`);
      } else {
        lines.push(`${label}预算已用 ${used.toFixed(0)}%。`);
      }
    } else if (prev) {
      const prevTotal = sumValue(prevEntries.filter((e) => e.kind === 'expense'));
      if (prevTotal > 0) {
        const diff = total - prevTotal;
        const p = Math.abs(diff / prevTotal) * 100;
        if (p >= 15) {
          lines.push(diff > 0
            ? `支出比上期多了 ${p.toFixed(0)}%（${fmtMoney(Math.abs(diff))}）。`
            : `支出比上期少了 ${p.toFixed(0)}%，省下 ${fmtMoney(Math.abs(diff))}。`);
        }
      }
    }
  }

  /* 学习 */
  if (study.length) {
    const st = sumValue(study);
    const goal = Number(state.settings.studyGoal) || 0;
    if (goal > 0) {
      const weeks = days / 7;
      const target = range === 'week' ? goal : goal * weeks;
      const p = (st / target) * 100;
      if (p >= 100) lines.push(`学习目标已达成（${p.toFixed(0)}%），很稳。`);
      else if (p >= 60) lines.push(`学习完成 ${p.toFixed(0)}%，再推一把就到目标了。`);
      else lines.push(`学习只完成 ${p.toFixed(0)}%，可以安排得再紧凑些。`);
    } else {
      const activeDays = new Set(study.map((e) => e.date)).size;
      if (days > 2) lines.push(`本期 ${days} 天里有 ${activeDays} 天在学习。`);
    }
  }

  /* 健身 */
  if (fit.length) {
    const goal = Number(state.settings.fitGoal) || 0;
    const ft = sumValue(fit);
    if (goal > 0) {
      const weeks = days / 7;
      const target = range === 'week' ? goal : goal * weeks;
      const p = (ft / target) * 100;
      if (p >= 100) lines.push(`健身目标也完成了（${p.toFixed(0)}%）。`);
      else lines.push(`健身完成 ${p.toFixed(0)}%。`);
    }
  }

  /* 什么都没设时，给个中性总结 */
  if (!lines.length) {
    if (entries.length === 0) return '';
    const parts = [];
    if (exp.length) parts.push(`花了 ${fmtMoney(total)}`);
    if (study.length) parts.push(`学习 ${fmtDuration(sumValue(study))}`);
    if (fit.length) parts.push(`健身 ${fmtDuration(sumValue(fit))}`);
    lines.push('本期' + parts.join('、') + '。');
  }

  return lines.slice(0, 3).join(' ');
}

/* ---------- 连续记录天数（含历史，不限于本期） ---------- */
function computeStreak(allEntries) {
  const active = activeOnly(allEntries);
  if (!active.length) return { current: 0, best: 0, total: 0 };

  const daySet = new Set(active.map((e) => e.date));

  // 当前连续（从今天或昨天往前数）
  let current = 0;
  let cur = todayYmd();
  if (!daySet.has(cur)) cur = addDays(cur, -1);   // 今天还没记不算断
  while (daySet.has(cur)) { current++; cur = addDays(cur, -1); }

  // 历史最长
  const sorted = [...daySet].sort();
  let best = 0, run = 0, prevDay = null;
  for (const d of sorted) {
    if (prevDay && addDays(prevDay, 1) === d) run++;
    else run = 1;
    if (run > best) best = run;
    prevDay = d;
  }

  return { current, best, total: daySet.size };
}
