/* =====================================================================
 * 生活记录 · 数据层
 * 纯本地存储（localStorage），支持导出 / 导入 JSON
 * ===================================================================== */

const STORAGE_KEY = 'lifelog.entries.v1';
const SETTINGS_KEY = 'lifelog.settings.v1';
const QUEUE_KEY = 'lifelog.syncqueue.v1';
const CUSTOM_CATS_KEY = 'lifelog.categories.v1';

/* 云端配置（部署前替换成你自己的项目地址与匿名密钥） */
const SUPABASE_URL = window.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';

/* ---------- 记录类型定义 ---------- */
/* categories = 内置默认分类；用户自定义分类另存，见 getCategories() */
const KINDS = {
  expense: {
    label: '支出',
    icon: '💸',
    unit: '元',
    field: 'amount',
    fieldLabel: '金额',
    categories: ['吃饭', '交通', '购物', '居住', '娱乐', '医疗', '人情', '其他'],
    decimals: 2,
  },
  study: {
    label: '学习',
    icon: '📚',
    unit: '分钟',
    field: 'minutes',
    fieldLabel: '时长',
    categories: ['英语', '编程', '阅读', '网课', '刷题', '其他'],
    decimals: 0,
  },
  fitness: {
    label: '健身',
    icon: '🏃',
    unit: '分钟',
    field: 'minutes',
    fieldLabel: '时长',
    categories: ['跑步', '力量', '游泳', '骑车', '球类', '拉伸'],
    decimals: 0,
  },
};

const KIND_ORDER = ['expense', 'study', 'fitness'];

/* ---------- 自定义分类 ---------- */
/* 结构：{ expense: ['游戏', '宠物'], study: [...], fitness: [...] } */
function loadCustomCats() {
  const empty = { expense: [], study: [], fitness: [] };
  try {
    const raw = localStorage.getItem(CUSTOM_CATS_KEY);
    if (!raw) return empty;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return empty;
    for (const k of KIND_ORDER) {
      if (!Array.isArray(obj[k])) obj[k] = [];
    }
    return obj;
  } catch (e) {
    return empty;
  }
}

function saveCustomCats(cats) {
  try {
    localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(cats));
    return true;
  } catch (e) {
    console.error('保存分类失败', e);
    return false;
  }
}

/* 合并默认 + 自定义，去重；「其他」永远放最后 */
function getCategories(kind) {
  const cfg = KINDS[kind];
  if (!cfg) return [];
  const custom = loadCustomCats()[kind] || [];
  const seen = new Set();
  const out = [];

  for (const c of [...cfg.categories, ...custom]) {
    const name = String(c || '').trim();
    if (!name || seen.has(name)) continue;
    if (name === '其他') continue;   // 稍后单独追加
    seen.add(name);
    out.push(name);
  }
  // 「其他」作为兜底选项始终存在
  if (cfg.categories.includes('其他')) out.push('其他');
  return out;
}

/* 新增自定义分类；返回 { ok, error } */
function addCustomCategory(kind, name) {
  const clean = String(name || '').trim();
  if (!clean) return { ok: false, error: '名称不能为空' };
  if (clean.length > 8) return { ok: false, error: '名称最多 8 个字' };
  if (/[<>"']/.test(clean)) return { ok: false, error: '名称不能包含特殊符号' };

  const cfg = KINDS[kind];
  if (!cfg) return { ok: false, error: '类型不存在' };
  if (cfg.categories.includes(clean)) return { ok: false, error: '这是内置分类，已存在' };

  const cats = loadCustomCats();
  if ((cats[kind] || []).includes(clean)) return { ok: false, error: '已经添加过了' };

  cats[kind] = [...(cats[kind] || []), clean];
  saveCustomCats(cats);
  return { ok: true };
}

/* 删除自定义分类；内置分类不可删 */
function removeCustomCategory(kind, name) {
  const cats = loadCustomCats();
  const list = cats[kind] || [];
  if (!list.includes(name)) return { ok: false, error: '只能删除自定义分类' };
  cats[kind] = list.filter((c) => c !== name);
  saveCustomCats(cats);
  return { ok: true };
}

/* 某分类是否属于自定义（决定能否删除） */
function isCustomCategory(kind, name) {
  const cfg = KINDS[kind];
  if (!cfg || cfg.categories.includes(name)) return false;
  return (loadCustomCats()[kind] || []).includes(name);
}

/* ---------- 读写 ---------- */
function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 兼容老版本数据：补齐同步所需字段
    return arr.filter(Boolean).map((e) => ({
      ...e,
      deleted: !!e.deleted,
      updatedAt: Number(e.updatedAt) || Number(e.ts) || Date.now(),
    }));
  } catch (e) {
    console.error('读取数据失败', e);
    return [];
  }
}

function saveEntries(list, opts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.error('保存失败', e);
    if (!(opts && opts.silent)) toast('保存失败：存储空间可能已满');
    return false;
  }
}

function loadSettings() {
  const def = { budget: 0, studyGoal: 0, fitGoal: 0 };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? Object.assign(def, JSON.parse(raw)) : def;
  } catch (e) {
    return def;
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/* ---------- 日期工具 ---------- */
// 统一用本地时区的 YYYY-MM-DD，避免 toISOString 的 UTC 偏移问题
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayYmd() {
  return ymd(new Date());
}

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 返回该日期所在周的周一
function weekStart(s) {
  const d = parseYmd(s);
  const day = d.getDay();            // 0=周日
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return ymd(d);
}

function isSameWeek(a, b) {
  return weekStart(a) === weekStart(b);
}

function isSameMonth(a, b) {
  return a.slice(0, 7) === b.slice(0, 7);
}

/* ---------- 记录模型 ---------- */
function makeEntry(kind, value, category, note, date) {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    value: Number(value),
    category: category || '其他',
    note: (note || '').trim(),
    date: date || todayYmd(),
    ts: now,
    deleted: false,
    updatedAt: now,
  };
}

/* ---------- 筛选与聚合 ---------- */
// 软删除的记录不参与任何展示与统计
function activeOnly(list) {
  return (list || []).filter((e) => e && !e.deleted);
}

function entriesOn(list, date) {
  return activeOnly(list).filter((e) => e.date === date);
}

function entriesBetween(list, start, end) {
  return activeOnly(list).filter((e) => e.date >= start && e.date <= end);
}

function inRange(list, kind, start, end) {
  return activeOnly(list).filter((e) => e.kind === kind && e.date >= start && e.date <= end);
}

function sumValue(entries) {
  return entries.reduce((acc, e) => acc + (Number(e.value) || 0), 0);
}

// 按分类聚合，返回 [{category, total, count}]，按 total 降序
function groupByCategory(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = e.category || '其他';
    if (!map.has(key)) map.set(key, { category: key, total: 0, count: 0 });
    const item = map.get(key);
    item.total += Number(e.value) || 0;
    item.count += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// 按天聚合（用于趋势），返回日期升序数组
function groupByDay(entries, start, end) {
  const map = new Map();
  for (const e of entries) {
    map.set(e.date, (map.get(e.date) || 0) + (Number(e.value) || 0));
  }
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push({ date: cur, total: map.get(cur) || 0 });
    cur = addDays(cur, 1);
  }
  return out;
}

/* ---------- 格式化 ---------- */
function fmtNum(n, decimals = 0) {
  const v = Number(n) || 0;
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtMoney(n) {
  return '¥' + fmtNum(n, 2);
}

// 分钟 → 1小时30分 可读形式
function fmtDuration(min) {
  const m = Math.round(Number(min) || 0);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} 小时` : `${h} 小时 ${r} 分`;
}
