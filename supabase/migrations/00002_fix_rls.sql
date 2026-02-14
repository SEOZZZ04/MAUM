-- ============================================================
-- Fix RLS infinite recursion & missing policies
-- ============================================================

-- 1) Create SECURITY DEFINER helper to check admin role
--    This avoids self-referencing the profiles table in its own RLS policy
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2) Fix profiles: admin policy was self-referencing → infinite recursion
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- 3) Fix couple_members: member policy was self-referencing → infinite recursion
DROP POLICY IF EXISTS "Members can read own couple members" ON public.couple_members;
CREATE POLICY "Members can read own couple members"
  ON public.couple_members FOR SELECT
  USING (couple_id = public.get_my_couple_id());

DROP POLICY IF EXISTS "Admins can read all couple members" ON public.couple_members;
CREATE POLICY "Admins can read all couple members"
  ON public.couple_members FOR SELECT
  USING (public.is_admin());

-- 4) Fix couples: admin policy referenced profiles (which had recursion)
DROP POLICY IF EXISTS "Admins can read all couples" ON public.couples;
CREATE POLICY "Admins can read all couples"
  ON public.couples FOR SELECT
  USING (public.is_admin());

-- 5) Fix all other admin policies to use is_admin()
DROP POLICY IF EXISTS "Admins can read all conversation days" ON public.conversation_days;
CREATE POLICY "Admins can read all conversation days"
  ON public.conversation_days FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read all messages" ON public.messages;
CREATE POLICY "Admins can read all messages"
  ON public.messages FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read all call logs" ON public.call_logs;
CREATE POLICY "Admins can read all call logs"
  ON public.call_logs FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read all daily summaries" ON public.daily_summaries;
CREATE POLICY "Admins can read all daily summaries"
  ON public.daily_summaries FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read all graph nodes" ON public.graph_nodes;
CREATE POLICY "Admins can read all graph nodes"
  ON public.graph_nodes FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read all graph edges" ON public.graph_edges;
CREATE POLICY "Admins can read all graph edges"
  ON public.graph_edges FOR SELECT
  USING (public.is_admin());

-- 6) Add missing INSERT policy on couple_invites
CREATE POLICY "Users can create invites"
  ON public.couple_invites FOR INSERT
  WITH CHECK (inviter_user_id = auth.uid());

-- 7) Add missing INSERT policies for couple workflow (redeem-invite-code)
CREATE POLICY "Authenticated users can insert couples"
  ON public.couples FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert couple members"
  ON public.couple_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- 8) Add UPDATE policy on couple_invites for redeeming
CREATE POLICY "Users can update invites when redeeming"
  ON public.couple_invites FOR UPDATE
  USING (true)
  WITH CHECK (used_by_user_id = auth.uid());
