-- ============================================================
-- Fix: Add direct FK from messages.sender_user_id to profiles.user_id
-- This allows PostgREST FK joins like:
--   messages.select('*, profiles:sender_user_id(nickname)')
-- Without this, PostgREST returns PGRST200 error because it can only
-- see the FK to auth.users, not the path through to profiles.
-- ============================================================

-- Add FK constraint (safe: won't fail if data is consistent since
-- profiles.user_id references auth.users.id and so does messages.sender_user_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'messages_sender_profile_fk'
    AND table_name = 'messages'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_sender_profile_fk
      FOREIGN KEY (sender_user_id) REFERENCES public.profiles(user_id);
  END IF;
END $$;

-- Also ensure the ensure_today_thread function exists
-- (re-create to make sure it's up to date)
CREATE OR REPLACE FUNCTION public.ensure_today_thread()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_couple_id uuid;
  v_today date;
  v_day record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT cm.couple_id INTO v_couple_id
  FROM couple_members cm
  WHERE cm.user_id = v_user_id
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION '커플이 연동되지 않았습니다';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  -- Archive old non-archived days
  UPDATE conversation_days
  SET archived = true
  WHERE couple_id = v_couple_id AND date < v_today AND archived = false;

  -- Find existing day for today
  SELECT * INTO v_day
  FROM conversation_days
  WHERE couple_id = v_couple_id AND date = v_today AND archived = false;

  -- Create if not exists
  IF v_day IS NULL THEN
    INSERT INTO conversation_days (couple_id, date, title, archived)
    VALUES (v_couple_id, v_today, v_today::text, false)
    RETURNING * INTO v_day;
  END IF;

  RETURN jsonb_build_object(
    'day', jsonb_build_object(
      'id', v_day.id,
      'couple_id', v_day.couple_id,
      'date', v_day.date,
      'title', v_day.title,
      'archived', v_day.archived
    )
  );
END;
$$;
