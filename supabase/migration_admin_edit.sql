-- ============================================================
-- マイグレーション: 管理者による全イベント編集・削除を許可
-- 実行場所: Supabase SQL Editor
-- https://supabase.com/dashboard/project/rrsbyiypwgnwzqadwpky/sql/new
-- ============================================================

-- ① events: 更新ポリシー（自分 OR 管理者）
DROP POLICY IF EXISTS "events_update_own" ON events;
CREATE POLICY "events_update_own"
  ON events FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ② events: 削除ポリシー（自分 OR 管理者）
DROP POLICY IF EXISTS "events_delete_own" ON events;
CREATE POLICY "events_delete_own"
  ON events FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ③ event_participants: 追加ポリシー（イベントオーナー OR 管理者）
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
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ④ event_participants: 削除ポリシー（イベントオーナー OR 管理者）
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
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );
