-- ============================================================
-- マイグレーション: 参加者・管理者による編集を許可
-- 実行場所: Supabase SQL Editor
-- https://supabase.com/dashboard/project/rrsbyiypwgnwzqadwpky/sql/new
-- ============================================================

-- ① events: 更新ポリシー（自分 OR 参加者 OR 管理者）
DROP POLICY IF EXISTS "events_update_own" ON events;
CREATE POLICY "events_update_own"
  ON events FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM event_participants
      WHERE event_participants.event_id = id
      AND event_participants.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM event_participants
      WHERE event_participants.event_id = id
      AND event_participants.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ② events: 削除ポリシー（自分 OR 管理者のみ）
DROP POLICY IF EXISTS "events_delete_own" ON events;
CREATE POLICY "events_delete_own"
  ON events FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ③ event_participants: 追加ポリシー（イベントオーナー OR 参加者 OR 管理者）
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
    OR EXISTS (
      SELECT 1 FROM event_participants ep2
      WHERE ep2.event_id = event_id
      AND ep2.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ④ event_participants: 削除ポリシー（イベントオーナー OR 参加者 OR 管理者）
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
    OR EXISTS (
      SELECT 1 FROM event_participants ep2
      WHERE ep2.event_id = event_id
      AND ep2.user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ============================================================
-- ⑤ 管理者フラグ設定（藤崎正博にis_admin=trueを付与）
-- ============================================================
UPDATE profiles SET is_admin = TRUE WHERE email = 'frex.design.2022@gmail.com';

-- 確認クエリ
SELECT id, name, email, is_admin FROM profiles WHERE is_admin = TRUE;
