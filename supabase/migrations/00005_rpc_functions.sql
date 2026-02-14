-- ============================================================
-- Migration: Add RPC functions for critical operations
-- These replace edge functions for connection operations
-- that don't require external APIs (like OpenAI).
-- Benefits: No separate deployment, runs in PostgreSQL,
-- more reliable than edge functions.
-- ============================================================

-- 1) Accept guest connection request
CREATE OR REPLACE FUNCTION public.accept_guest_connection(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request record;
  v_user_id uuid;
  v_couple_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_request
  FROM guest_connection_requests
  WHERE id = p_request_id;

  IF v_request IS NULL THEN
    RAISE EXCEPTION '요청을 찾을 수 없습니다';
  END IF;
  IF v_request.to_user_id != v_user_id THEN
    RAISE EXCEPTION '이 요청을 수락할 권한이 없습니다';
  END IF;
  IF v_request.status != 'pending' THEN
    RAISE EXCEPTION '이미 처리된 요청입니다';
  END IF;

  -- Check neither user already has a couple
  IF EXISTS (SELECT 1 FROM couple_members WHERE user_id = v_request.from_user_id) THEN
    RAISE EXCEPTION '상대방이 이미 커플 연동되어 있습니다';
  END IF;
  IF EXISTS (SELECT 1 FROM couple_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION '이미 커플이 연동되어 있습니다';
  END IF;

  -- Create couple
  INSERT INTO couples DEFAULT VALUES RETURNING id INTO v_couple_id;

  -- Add both members
  INSERT INTO couple_members (couple_id, user_id) VALUES
    (v_couple_id, v_request.from_user_id),
    (v_couple_id, v_user_id);

  -- Update request status
  UPDATE guest_connection_requests SET status = 'accepted' WHERE id = p_request_id;

  RETURN jsonb_build_object('couple_id', v_couple_id, 'message', '연결 완료!');
END;
$$;

-- 2) Create invite code
CREATE OR REPLACE FUNCTION public.create_invite_code()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_code text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Check if user already has a couple
  IF EXISTS (SELECT 1 FROM couple_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION '이미 커플이 연동되어 있습니다';
  END IF;

  -- Generate random 8-char hex code
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- Delete old unused codes by this user
  DELETE FROM couple_invites WHERE inviter_user_id = v_user_id AND used_at IS NULL;

  -- Insert new code (24h expiry)
  INSERT INTO couple_invites (inviter_user_id, code, expires_at)
  VALUES (v_user_id, v_code, now() + interval '24 hours');

  RETURN jsonb_build_object('code', v_code);
END;
$$;

-- 3) Redeem invite code
CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_invite record;
  v_couple_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Check if user already has a couple
  IF EXISTS (SELECT 1 FROM couple_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION '이미 커플이 연동되어 있습니다';
  END IF;

  -- Find valid invite
  SELECT * INTO v_invite
  FROM couple_invites
  WHERE code = upper(trim(p_code))
    AND used_at IS NULL
    AND expires_at > now();

  IF v_invite IS NULL THEN
    RAISE EXCEPTION '유효하지 않거나 만료된 초대코드입니다';
  END IF;
  IF v_invite.inviter_user_id = v_user_id THEN
    RAISE EXCEPTION '자신의 초대코드는 사용할 수 없습니다';
  END IF;

  -- Check inviter isn't already coupled
  IF EXISTS (SELECT 1 FROM couple_members WHERE user_id = v_invite.inviter_user_id) THEN
    RAISE EXCEPTION '초대자가 이미 커플이 연동되어 있습니다';
  END IF;

  -- Create couple
  INSERT INTO couples DEFAULT VALUES RETURNING id INTO v_couple_id;

  -- Add both members
  INSERT INTO couple_members (couple_id, user_id) VALUES
    (v_couple_id, v_invite.inviter_user_id),
    (v_couple_id, v_user_id);

  -- Mark invite as used
  UPDATE couple_invites
  SET used_at = now(), used_by_user_id = v_user_id, couple_id = v_couple_id
  WHERE id = v_invite.id;

  RETURN jsonb_build_object('couple_id', v_couple_id, 'message', '커플 연동 완료!');
END;
$$;

-- 4) Ensure today's conversation thread
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

  -- Get user's couple
  SELECT cm.couple_id INTO v_couple_id
  FROM couple_members cm
  WHERE cm.user_id = v_user_id
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION '커플이 연동되지 않았습니다';
  END IF;

  -- Use KST date
  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  -- Archive old non-archived days
  UPDATE conversation_days
  SET archived = true
  WHERE couple_id = v_couple_id AND date < v_today AND archived = false;

  -- Try to find existing day for today
  SELECT * INTO v_day
  FROM conversation_days
  WHERE couple_id = v_couple_id AND date = v_today AND archived = false;

  -- Create new day if not exists
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
