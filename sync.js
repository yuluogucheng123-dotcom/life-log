/* =====================================================================
 * 生活记录 · 云端同步（Supabase）
 *
 * 架构：离线优先（offline-first）
 *   - 本地 localStorage 是唯一的数据源，界面只读它 → 永远秒开、断网可用
 *   - 每次增删改，先在本地生效，再后台推到云端
 *   - 推送失败的改动进入"待同步队列"，联网后自动重试
 *   - 删除用软删除（deleted 标记），避免多设备互相"复活"数据
 *
 * 同步模型：last-write-wins（按 updated_at 比较），对个人记录类应用足够。
 * ===================================================================== */

const SYNC = {
  client: null,
  user: null,
  online: true,
  syncing: false,
  lastSyncAt: 0,
  lastError: null,
  listeners: [],

  /* ---------- 初始化 ---------- */
  async init() {
    if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      this.emit({ status: 'unconfigured' });
      return false;
    }

    this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });

    // 网络状态
    this.online = navigator.onLine;
    window.addEventListener('online', () => {
      this.online = true;
      this.emit({ status: 'online' });
      this.flush();          // 联网后立刻补推
    });
    window.addEventListener('offline', () => {
      this.online = false;
      this.emit({ status: 'offline' });
    });

    // 恢复已有会话
    try {
      const { data } = await this.client.auth.getSession();
      if (data && data.session) {
        this.user = data.session.user;
        this.emit({ status: 'signed-in', user: this.user });
        await this.pull();
        await this.flush();
        return true;
      }
    } catch (e) {
      console.warn('恢复会话失败', e);
    }

    this.emit({ status: 'signed-out' });
    return false;
  },

  /* ---------- 订阅状态变化（供 UI 更新） ---------- */
  subscribe(fn) { this.listeners.push(fn); },
  emit(payload) {
    this.listeners.forEach((fn) => {
      try { fn(payload); } catch (e) { console.warn(e); }
    });
  },

  /* ---------- 认证 ---------- */
  async signUp(email, password) {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    // 若项目开启了邮箱验证，此时还没有 session
    if (!data.session) {
      return { needConfirm: true };
    }
    this.user = data.user;
    this.emit({ status: 'signed-in', user: this.user });
    await this.pull();
    await this.flush();
    return { needConfirm: false };
  },

  async signIn(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
    this.emit({ status: 'signed-in', user: this.user });
    await this.pull();
    await this.flush();
    return true;
  },

  async signOut() {
    try { await this.client.auth.signOut(); } catch (e) { console.warn(e); }
    this.user = null;
    this.emit({ status: 'signed-out' });
  },

  isSignedIn() { return !!this.user; },

  /* ---------- 待同步队列（存本地） ---------- */
  _queue: [],

  loadQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      this._queue = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this._queue)) this._queue = [];
    } catch (e) { this._queue = []; }
    return this._queue;
  },

  saveQueue() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(this._queue)); } catch (e) {}
  },

  enqueue(op) {
    this._queue.push(op);
    this.saveQueue();
    this.emit({ status: 'pending', count: this._queue.length });
  },

  /* ---------- 推送本地改动到云端 ---------- */
  async flush() {
    if (!this.isSignedIn() || !this.online) return;
    // 已有同步在跑：标记需要再跑一轮，避免这次改动被漏掉
    if (this.syncing) { this._again = true; return; }

    this.loadQueue();
    if (!this._queue.length) return;

    this.syncing = true;
    this._again = false;
    this.emit({ status: 'syncing' });

    const remaining = [];
    let okCount = 0;

    for (const op of this._queue) {
      try {
        if (op.type === 'upsert') {
          // 表的主键是 (id, user_id) 复合主键，冲突列必须与之一致
          const { error } = await this.client
            .from('entries')
            .upsert(op.row, { onConflict: 'id,user_id' });
          if (error) throw error;
          okCount++;
        } else if (op.type === 'settings') {
          const { error } = await this.client
            .from('settings')
            .upsert(op.row, { onConflict: 'user_id' });
          if (error) throw error;
          okCount++;
        }
      } catch (e) {
        const msg = String((e && e.message) || e);
        // 权限 / 令牌类问题：记录下来，保留队列等修复
        if (/permission|JWT|row-level security|not authorized/i.test(msg)) {
          this.lastError = '权限或登录状态异常：' + msg;
          remaining.push(op);
        } else if (/duplicate|violates|invalid|constraint/i.test(msg)) {
          // 数据本身有问题（例如主键冲突）：记录下来便于排查，但不无限重试
          this.lastError = '数据写入被拒绝：' + msg;
          console.warn('[同步] 丢弃无法处理的记录', msg, op.row && op.row.id);
        } else {
          // 网络类问题：静默保留，联网后重试
          remaining.push(op);
        }
      }
    }

    this._queue = remaining;
    this.saveQueue();
    this.syncing = false;
    this.lastSyncAt = Date.now();
    this.lastError = remaining.length ? '部分数据未能同步' : null;

    this.emit({
      status: remaining.length ? 'pending' : 'synced',
      count: remaining.length,
      pushed: okCount,
    });

    // 同步期间又有新改动 → 立刻补一轮
    if (this._again) {
      this._again = false;
      return this.flush();
    }
  },

  /* ---------- 从云端拉取并合并 ---------- */
  async pull() {
    if (!this.isSignedIn() || !this.online) return false;
    try {
      const { data, error } = await this.client
        .from('entries')
        .select('*')
        .order('updated_at', { ascending: true });
      if (error) throw error;

      const local = loadEntries();
      const map = new Map(local.map((e) => [e.id, e]));

      // 有待推送的本地改动时，不用云端数据覆盖它，避免刚记的账被抹掉
      this.loadQueue();
      const pendingIds = new Set(
        this._queue.filter((op) => op.type === 'upsert' && op.row).map((op) => op.row.id)
      );

      for (const row of data || []) {
        const remote = rowToEntry(row);
        if (pendingIds.has(remote.id)) continue;   // 本地更新更新，等推送
        const mine = map.get(remote.id);
        // 云端更新更晚，或本地没有 → 采用云端
        if (!mine || (remote.updatedAt || 0) > (mine.updatedAt || 0)) {
          map.set(remote.id, remote);
        }
      }

      const merged = [...map.values()];
      saveEntries(merged, { silent: true });

      // 顺便拉取设置与自定义分类
      try {
        const st = await this.client
          .from('settings')
          .select('*')
          .eq('user_id', this.user.id)
          .maybeSingle();
        if (!st.error && st.data) applySettingsRow(st.data);
      } catch (e) {
        console.warn('拉取设置失败', e);
      }

      this.lastSyncAt = Date.now();
      // 通知界面：数据已变化（含分类），让 UI 重新读取并渲染
      this.emit({ status: 'synced', merged: merged.length, dataChanged: true });
      return true;
    } catch (e) {
      console.warn('拉取失败', e);
      this.lastError = '拉取失败：' + (e.message || e);
      this.emit({ status: 'error', error: this.lastError });
      return false;
    }
  },

  /* ---------- 完整同步（推送 + 拉取） ---------- */
  async syncNow() {
    if (!this.isSignedIn()) return false;
    if (!this.online) { this.emit({ status: 'offline' }); return false; }
    await this.flush();
    return this.pull();
  },

  /* ---------- 迁移：把本地已有数据推到账户 ---------- */
  async migrateLocalData() {
    if (!this.isSignedIn()) return 0;
    const local = loadEntries();
    if (!local.length) return 0;
    let n = 0;
    for (const e of local) {
      this.enqueue({ type: 'upsert', row: entryToRow(e) });
      n++;
    }
    if (state.settings && (state.settings.budget || state.settings.studyGoal || state.settings.fitGoal)) {
      this.enqueue({ type: 'settings', row: settingsToRow(state.settings) });
    }
    await this.flush();
    return n;
  },
};

/* ---------- 行 ↔ 记录 转换 ---------- */
function entryToRow(e) {
  return {
    id: e.id,
    user_id: SYNC.user.id,
    kind: e.kind,
    value: e.value,
    category: e.category || '其他',
    note: e.note || '',
    date: e.date,
    ts: e.ts || Date.now(),
    deleted: !!e.deleted,
    updated_at: new Date(e.updatedAt || Date.now()).toISOString(),
  };
}

function rowToEntry(r) {
  return {
    id: r.id,
    kind: r.kind,
    value: Number(r.value),
    category: r.category || '其他',
    note: r.note || '',
    date: r.date,
    ts: Number(r.ts) || Date.parse(r.updated_at) || Date.now(),
    deleted: !!r.deleted,
    updatedAt: Date.parse(r.updated_at) || Date.now(),
  };
}

function settingsToRow(s) {
  const cats = loadCustomCats();
  return {
    user_id: SYNC.user.id,
    budget: Number(s.budget) || 0,
    study_goal: Number(s.studyGoal) || 0,
    fit_goal: Number(s.fitGoal) || 0,
    // 自定义分类跟随设置一起同步，避免"手机上加了电脑看不到"
    custom_cats: JSON.stringify(cats),
    updated_at: new Date().toISOString(),
  };
}

/* 把云端设置写回本地 */
function applySettingsRow(row) {
  if (!row) return;

  if (row.budget !== undefined || row.study_goal !== undefined || row.fit_goal !== undefined) {
    const s = loadSettings();
    s.budget = Number(row.budget) || 0;
    s.studyGoal = Number(row.study_goal) || 0;
    s.fitGoal = Number(row.fit_goal) || 0;
    saveSettings(s);
  }

  if (row.custom_cats) {
    try {
      const cats = typeof row.custom_cats === 'string'
        ? JSON.parse(row.custom_cats)
        : row.custom_cats;
      if (cats && typeof cats === 'object') {
        const cur = loadCustomCats();
        for (const k of KIND_ORDER) {
          if (Array.isArray(cats[k])) {
            // 合并去重，避免覆盖掉本地刚加的分类
            const merged = [...new Set([...(cur[k] || []), ...cats[k]])];
            cur[k] = merged;
          }
        }
        saveCustomCats(cur);
      }
    } catch (e) {
      console.warn('解析云端分类失败', e);
    }
  }
}
