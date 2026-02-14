-- ============================================================
-- Fix real-time subscriptions, RLS, and DELETE policies
-- ============================================================

-- 1) Add profiles to realtime publication (needed for is_online changes)
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

-- 2) Add couple_members to realtime publication (needed for couple linking/unlinking)
ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_members;

-- 3) Allow authenticated users to read any profile
--    Needed for: guest lobby, couple partner profile, message sender names
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.profiles;
CREATE POLICY "Authenticated users can read profiles"
  ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 4) Fix couple_members INSERT policy
--    Old policy (user_id = auth.uid()) blocks inserting partner's row
DROP POLICY IF EXISTS "Authenticated users can insert couple members" ON public.couple_members;
CREATE POLICY "Authenticated users can insert couple members"
  ON public.couple_members FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- 5) DELETE policies - CRITICAL: none existed before!
--    Without these, disconnectCouple() silently fails.
-- ============================================================

-- couples: members can delete their couple
CREATE POLICY "Members can delete own couple"
  ON public.couples FOR DELETE
  USING (id = public.get_my_couple_id());

-- couple_members: members can delete their couple's memberships
CREATE POLICY "Members can delete own couple members"
  ON public.couple_members FOR DELETE
  USING (couple_id = public.get_my_couple_id());

-- couple_invites: delete invites for own couple or own invites
CREATE POLICY "Users can delete own couple invites"
  ON public.couple_invites FOR DELETE
  USING (
    couple_id = public.get_my_couple_id()
    OR inviter_user_id = auth.uid()
  );

-- messages: couple members can delete their messages
CREATE POLICY "Couple members can delete their messages"
  ON public.messages FOR DELETE
  USING (couple_id = public.get_my_couple_id());

-- conversation_days: couple members can delete their days
CREATE POLICY "Couple members can delete their conversation days"
  ON public.conversation_days FOR DELETE
  USING (couple_id = public.get_my_couple_id());

-- graph_nodes: couple members can delete their nodes
CREATE POLICY "Couple members can delete their graph nodes"
  ON public.graph_nodes FOR DELETE
  USING (couple_id = public.get_my_couple_id());

-- graph_edges: couple members can delete their edges
CREATE POLICY "Couple members can delete their graph edges"
  ON public.graph_edges FOR DELETE
  USING (couple_id = public.get_my_couple_id());

-- daily_summaries: couple members can delete their summaries
CREATE POLICY "Couple members can delete their daily summaries"
  ON public.daily_summaries FOR DELETE
  USING (couple_id = public.get_my_couple_id());

-- call_logs: couple members can delete their call logs
CREATE POLICY "Couple members can delete their call logs"
  ON public.call_logs FOR DELETE
  USING (couple_id = public.get_my_couple_id());

-- uploads: couple members can delete their uploads
CREATE POLICY "Couple members can delete their uploads"
  ON public.uploads FOR DELETE
  USING (couple_id = public.get_my_couple_id());

-- guest_connection_requests: users can delete their own requests
CREATE POLICY "Users can delete own connection requests"
  ON public.guest_connection_requests FOR DELETE
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);
