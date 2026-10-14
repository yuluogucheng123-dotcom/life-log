-- =====================================================================
-- 生活记录 · Supabase 数据库初始化
--
-- 在 Supabase 控制台 → SQL Editor → New query，
-- 把本文件全部内容粘贴进去，点 RUN 执行一次即可。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 记录表
-- ---------------------------------------------------------------------
create table if not exists public.entries (
  id          text        not null,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  kind        text        not null check (kind in ('expense','study','fitness')),
  value       numeric     not null default 0,
  category    text        not null default '其他',
  note        text        not null default '',
  date        date        not null,
  ts          bigint      not null default 0,
  deleted     boolean     not null default false,
  updated_at  timestamptz not null default now(),
  primary key (id, user_id)
);

create index if not exists entries_user_date_idx on public.entries (user_id, date desc);
create index if not exists entries_user_updated_idx on public.entries (user_id, updated_at desc);

-- ---------------------------------------------------------------------
-- 2. 设置表（预算与目标，每个用户一行）
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  budget      numeric     not null default 0,
  study_goal  numeric     not null default 0,
  fit_goal    numeric     not null default 0,
  custom_cats text        not null default '{}',   -- 用户自定义分类（JSON）
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. 行级安全（RLS）：每个人只能读写自己的数据
--    —— 这是关键，没有它任何人都能读到你的记录
-- ---------------------------------------------------------------------
alter table public.entries  enable row level security;
alter table public.settings enable row level security;

-- entries 策略
drop policy if exists "own entries select" on public.entries;
drop policy if exists "own entries insert" on public.entries;
drop policy if exists "own entries update" on public.entries;
drop policy if exists "own entries delete" on public.entries;

create policy "own entries select" on public.entries
  for select using (auth.uid() = user_id);

create policy "own entries insert" on public.entries
  for insert with check (auth.uid() = user_id);

create policy "own entries update" on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own entries delete" on public.entries
  for delete using (auth.uid() = user_id);

-- settings 策略
drop policy if exists "own settings select" on public.settings;
drop policy if exists "own settings insert" on public.settings;
drop policy if exists "own settings update" on public.settings;

create policy "own settings select" on public.settings
  for select using (auth.uid() = user_id);

create policy "own settings insert" on public.settings
  for insert with check (auth.uid() = user_id);

create policy "own settings update" on public.settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4. 完成
-- ---------------------------------------------------------------------
-- 执行成功后，你应该看到 "Success. No rows returned"。
-- 可以到 Table Editor 里确认 entries 和 settings 两张表已经出现。
