-- ============================================================
-- Fix real-time subscriptions, RLS, and DELETE policies
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1) Add tables to realtime publication (safe: skip if already added)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already added, skip
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_members;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 2) Allow authenticated users to read any profile
--    Needed for: guest lobby, couple partner profile, message sender names
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.profiles;
CREATE POLICY "Authenticated users can read profiles"
  ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 3) Fix couple_members INSERT policy
DROP POLICY IF EXISTS "Authenticated users can insert couple members" ON public.couple_members;
CREATE POLICY "Authenticated users can insert couple members"
  ON public.couple_members FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- 4) DELETE policies - CRITICAL: none existed before!
-- ============================================================

DROP POLICY IF EXISTS "Members can delete own couple" ON public.couples;
CREATE POLICY "Members can delete own couple"
  ON public.couples FOR DELETE
  USING (id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Members can delete own couple members" ON public.couple_members;
CREATE POLICY "Members can delete own couple members"
  ON public.couple_members FOR DELETE
  USING (couple_id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Users can delete own couple invites" ON public.couple_invites;
CREATE POLICY "Users can delete own couple invites"
  ON public.couple_invites FOR DELETE
  USING (
    couple_id = public.get_my_couple_id()
    OR inviter_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Couple members can delete their messages" ON public.messages;
CREATE POLICY "Couple members can delete their messages"
  ON public.messages FOR DELETE
  USING (couple_id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Couple members can delete their conversation days" ON public.conversation_days;
CREATE POLICY "Couple members can delete their conversation days"
  ON public.conversation_days FOR DELETE
  USING (couple_id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Couple members can delete their graph nodes" ON public.graph_nodes;
CREATE POLICY "Couple members can delete their graph nodes"
  ON public.graph_nodes FOR DELETE
  USING (couple_id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Couple members can delete their graph edges" ON public.graph_edges;
CREATE POLICY "Couple members can delete their graph edges"
  ON public.graph_edges FOR DELETE
  USING (couple_id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Couple members can delete their daily summaries" ON public.daily_summaries;
CREATE POLICY "Couple members can delete their daily summaries"
  ON public.daily_summaries FOR DELETE
  USING (couple_id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Couple members can delete their call logs" ON public.call_logs;
CREATE POLICY "Couple members can delete their call logs"
  ON public.call_logs FOR DELETE
  USING (couple_id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Couple members can delete their uploads" ON public.uploads;
CREATE POLICY "Couple members can delete their uploads"
  ON public.uploads FOR DELETE
  USING (couple_id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Users can delete own connection requests" ON public.guest_connection_requests;
CREATE POLICY "Users can delete own connection requests"
  ON public.guest_connection_requests FOR DELETE
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);
