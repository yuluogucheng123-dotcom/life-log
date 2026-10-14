-- =====================================================================
-- 生活记录 · 数据库升级补丁
--
-- 用途：给已建好的项目添加「自定义分类」支持。
-- 在 Supabase 控制台 → SQL Editor → New query，粘贴本文件全部内容 → RUN。
--
-- 如果这是全新项目，直接跑 supabase-schema.sql 即可（它已包含这些字段）。
-- =====================================================================

-- 给设置表加上自定义分类字段（存 JSON 字符串）
alter table public.settings
  add column if not exists custom_cats text not null default '{}';

-- 完成。执行成功后应显示 "Success. No rows returned"。
