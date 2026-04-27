-- ============================================================
-- FRe:x Schedule - Supabase データベース設定SQL
-- ============================================================
-- 実行順序: Supabase の SQL Editor で全体を貼り付けて実行
-- ============================================================

-- ----------------------------------------
-- 拡張機能
-- ----------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------
-- テーブル作成
-- ----------------------------------------

-- profiles テーブル（ユーザープロフィール）
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  department TEXT DEFAULT '',
  avatar_color TEXT DEFAULT '#4A90E2',
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- events テーブル（予定）
CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  start_datetime TIMESTAMPTZ NOT NULL,
  end_datetime TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN DEFAULT FALSE,
  memo TEXT DEFAULT '',
  facility TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- event_participants テーブル（予定参加者）
CREATE TABLE IF NOT EXISTS event_participants (
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

-- todos テーブル（TODOリスト）
CREATE TABLE IF NOT EXISTS todos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  due_date DATE,
  completed BOOLEAN DEFAULT FALSE,
  priority INT DEFAULT 2,  -- 1:高, 2:中, 3:低
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- day_memos テーブル（個人日メモ）
CREATE TABLE IF NOT EXISTS day_memos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  memo_date DATE NOT NULL,
  content TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, memo_date)
);

-- facilities テーブル（施設・会議室）
CREATE TABLE IF NOT EXISTS facilities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort_order INT DEFAULT 0
);

-- ----------------------------------------
-- updated_at 自動更新トリガー
-- ----------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON profiles;
CREATE TRIGGER trigger_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_events_updated_at ON events;
CREATE TRIGGER trigger_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------
-- auth.users にユーザー登録時に profiles を自動作成するトリガー
-- ----------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, name, email, avatar_color)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'avatar_color', '#4A90E2')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ----------------------------------------
-- Row Level Security (RLS) の有効化
-- ----------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------
-- RLS ポリシー: profiles
-- ----------------------------------------

-- 全員が全プロフィールを参照可（グループカレンダーのため）
DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
CREATE POLICY "profiles_select_all"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- 自分のプロフィールのみ挿入可
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- 自分のプロフィールのみ更新可
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ----------------------------------------
-- RLS ポリシー: events
-- ----------------------------------------

-- 全員が全イベントを参照可（グループカレンダーのため）
DROP POLICY IF EXISTS "events_select_all" ON events;
CREATE POLICY "events_select_all"
  ON events FOR SELECT
  TO authenticated
  USING (true);

-- 自分のみイベントを作成可
DROP POLICY IF EXISTS "events_insert_own" ON events;
CREATE POLICY "events_insert_own"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 自分のイベントのみ更新可
DROP POLICY IF EXISTS "events_update_own" ON events;
CREATE POLICY "events_update_own"
  ON events FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 自分のイベントのみ削除可
DROP POLICY IF EXISTS "events_delete_own" ON events;
CREATE POLICY "events_delete_own"
  ON events FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------
-- RLS ポリシー: event_participants
-- ----------------------------------------

-- 全員が参照可
DROP POLICY IF EXISTS "event_participants_select_all" ON event_participants;
CREATE POLICY "event_participants_select_all"
  ON event_participants FOR SELECT
  TO authenticated
  USING (true);

-- イベントオーナーが参加者を追加可
DROP POLICY IF EXISTS "event_participants_insert_owner" ON event_participants;
CREATE POLICY "event_participants_insert_owner"
  ON event_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
      AND events.user_id = auth.uid()
    )
  );

-- イベントオーナーが参加者を削除可
DROP POLICY IF EXISTS "event_participants_delete_owner" ON event_participants;
CREATE POLICY "event_participants_delete_owner"
  ON event_participants FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
      AND events.user_id = auth.uid()
    )
  );

-- ----------------------------------------
-- RLS ポリシー: todos
-- ----------------------------------------

-- 自分のTODOのみ参照可
DROP POLICY IF EXISTS "todos_select_own" ON todos;
CREATE POLICY "todos_select_own"
  ON todos FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 自分のTODOのみ作成可
DROP POLICY IF EXISTS "todos_insert_own" ON todos;
CREATE POLICY "todos_insert_own"
  ON todos FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 自分のTODOのみ更新可
DROP POLICY IF EXISTS "todos_update_own" ON todos;
CREATE POLICY "todos_update_own"
  ON todos FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 自分のTODOのみ削除可
DROP POLICY IF EXISTS "todos_delete_own" ON todos;
CREATE POLICY "todos_delete_own"
  ON todos FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------
-- RLS ポリシー: facilities
-- ----------------------------------------

-- 全員が施設を参照可
DROP POLICY IF EXISTS "facilities_select_all" ON facilities;
CREATE POLICY "facilities_select_all"
  ON facilities FOR SELECT
  TO authenticated
  USING (true);

-- 管理者のみ施設を作成可
DROP POLICY IF EXISTS "facilities_insert_admin" ON facilities;
CREATE POLICY "facilities_insert_admin"
  ON facilities FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = TRUE
    )
  );

-- 管理者のみ施設を更新可
DROP POLICY IF EXISTS "facilities_update_admin" ON facilities;
CREATE POLICY "facilities_update_admin"
  ON facilities FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = TRUE
    )
  );

-- 管理者のみ施設を削除可
DROP POLICY IF EXISTS "facilities_delete_admin" ON facilities;
CREATE POLICY "facilities_delete_admin"
  ON facilities FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = TRUE
    )
  );

-- updated_at トリガー（day_memos）
DROP TRIGGER IF EXISTS trigger_day_memos_updated_at ON day_memos;
CREATE TRIGGER trigger_day_memos_updated_at
  BEFORE UPDATE ON day_memos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------
-- RLS ポリシー: day_memos
-- ----------------------------------------
ALTER TABLE day_memos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "day_memos_select_own" ON day_memos;
CREATE POLICY "day_memos_select_own"
  ON day_memos FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "day_memos_insert_own" ON day_memos;
CREATE POLICY "day_memos_insert_own"
  ON day_memos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "day_memos_update_own" ON day_memos;
CREATE POLICY "day_memos_update_own"
  ON day_memos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "day_memos_delete_own" ON day_memos;
CREATE POLICY "day_memos_delete_own"
  ON day_memos FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_day_memos_user_date ON day_memos(user_id, memo_date);

-- ----------------------------------------
-- Realtime 有効化
-- ----------------------------------------
-- Supabase ダッシュボード > Database > Replication で
-- 以下のテーブルを有効化してください:
-- - events
-- - event_participants
-- - profiles

-- ----------------------------------------
-- 初期データ: サンプル施設
-- ----------------------------------------
INSERT INTO facilities (name, description, sort_order) VALUES
  ('第1会議室', '定員6名・プロジェクター完備', 1),
  ('第2会議室', '定員12名・大型モニター完備', 2),
  ('応接室', '定員4名・来客対応用', 3)
ON CONFLICT DO NOTHING;

-- ----------------------------------------
-- インデックス（パフォーマンス最適化）
-- ----------------------------------------
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_start_datetime ON events(start_datetime);
CREATE INDEX IF NOT EXISTS idx_events_end_datetime ON events(end_datetime);
CREATE INDEX IF NOT EXISTS idx_event_participants_event_id ON event_participants(event_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_user_id ON event_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

-- ============================================================
-- セットアップ完了！
-- ============================================================

-- ============================================================
-- iCal ライブフィード用マイグレーション（追加実行）
-- ============================================================

-- profiles テーブルに ical_token カラムを追加
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ical_token UUID DEFAULT gen_random_uuid() NOT NULL;

-- ical_token の一意インデックス（検索高速化）
CREATE UNIQUE INDEX IF NOT EXISTS profiles_ical_token_idx ON profiles(ical_token);

-- RLSポリシー: ical_token は本人のみ更新可
-- (profiles テーブルのRLSが有効な場合、SELECTポリシーは既存のものを流用)

-- ============================================================
-- 非公開予定機能 マイグレーション（追加実行）
-- ============================================================

-- events テーブルに is_private カラムを追加
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE;

-- RLSポリシーを更新: 非公開イベントは本人のみ参照可
DROP POLICY IF EXISTS "events_select_all" ON events;
CREATE POLICY "events_select_all"
  ON events FOR SELECT
  TO authenticated
  USING (is_private = FALSE OR user_id = auth.uid());
