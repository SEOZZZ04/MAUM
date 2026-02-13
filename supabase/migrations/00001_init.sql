-- ============================================================
-- MAUM: Couple Relationship Analysis App - Full DB Schema
-- ============================================================

-- 1) profiles
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text,
  avatar_url text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'
    )
  );

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nickname, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'User'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
  )
  ON CONFLICT (user_id) DO UPDATE SET
    nickname = COALESCE(EXCLUDED.nickname, profiles.nickname),
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) couples
CREATE TABLE public.couples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;

-- 3) couple_members
CREATE TABLE public.couple_members (
  id bigserial PRIMARY KEY,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(couple_id, user_id)
);

CREATE INDEX idx_couple_members_user ON public.couple_members(user_id);
CREATE INDEX idx_couple_members_couple ON public.couple_members(couple_id);

ALTER TABLE public.couple_members ENABLE ROW LEVEL SECURITY;

-- Helper function: get couple_id for current user
CREATE OR REPLACE FUNCTION public.get_my_couple_id()
RETURNS uuid AS $$
  SELECT couple_id FROM public.couple_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- RLS for couples
CREATE POLICY "Members can read own couple"
  ON public.couples FOR SELECT
  USING (
    id IN (SELECT couple_id FROM public.couple_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can read all couples"
  ON public.couples FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- RLS for couple_members
CREATE POLICY "Members can read own couple members"
  ON public.couple_members FOR SELECT
  USING (
    couple_id IN (SELECT couple_id FROM public.couple_members cm WHERE cm.user_id = auth.uid())
  );

CREATE POLICY "Admins can read all couple members"
  ON public.couple_members FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 4) couple_invites
CREATE TABLE public.couple_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_user_id uuid NOT NULL REFERENCES auth.users(id),
  couple_id uuid REFERENCES public.couples(id),
  code text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  used_at timestamptz,
  used_by_user_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.couple_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own invites"
  ON public.couple_invites FOR SELECT
  USING (inviter_user_id = auth.uid() OR used_by_user_id = auth.uid());

-- 5) conversation_days
CREATE TABLE public.conversation_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  date date NOT NULL,
  title text,
  title_override text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(couple_id, date, archived)
);

CREATE INDEX idx_conversation_days_couple_date ON public.conversation_days(couple_id, date DESC);

ALTER TABLE public.conversation_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Couple members can read their conversation days"
  ON public.conversation_days FOR SELECT
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can insert conversation days"
  ON public.conversation_days FOR INSERT
  WITH CHECK (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can update conversation days"
  ON public.conversation_days FOR UPDATE
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Admins can read all conversation days"
  ON public.conversation_days FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 6) messages
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  day_id uuid NOT NULL REFERENCES public.conversation_days(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id),
  text text NOT NULL,
  source text NOT NULL DEFAULT 'chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_messages_day ON public.messages(day_id, created_at);
CREATE INDEX idx_messages_couple ON public.messages(couple_id, created_at DESC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Couple members can read their messages"
  ON public.messages FOR SELECT
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can insert messages"
  ON public.messages FOR INSERT
  WITH CHECK (couple_id = public.get_my_couple_id() AND sender_user_id = auth.uid());

CREATE POLICY "Admins can read all messages"
  ON public.messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 7) uploads
CREATE TABLE public.uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  type text NOT NULL CHECK (type IN ('kakao_txt', 'call_audio')),
  storage_path text NOT NULL,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Couple members can read their uploads"
  ON public.uploads FOR SELECT
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can insert uploads"
  ON public.uploads FOR INSERT
  WITH CHECK (couple_id = public.get_my_couple_id() AND user_id = auth.uid());

-- 8) call_logs
CREATE TABLE public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  upload_id uuid REFERENCES public.uploads(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  transcript text,
  summary text,
  timeline jsonb,
  emotions jsonb,
  keywords jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Couple members can read their call logs"
  ON public.call_logs FOR SELECT
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can insert call logs"
  ON public.call_logs FOR INSERT
  WITH CHECK (couple_id = public.get_my_couple_id());

CREATE POLICY "Admins can read all call logs"
  ON public.call_logs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 9) daily_summaries
CREATE TABLE public.daily_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  date date NOT NULL,
  title text,
  title_override text,
  diary_text text,
  mood jsonb,
  highlights jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(couple_id, date)
);

ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Couple members can read their daily summaries"
  ON public.daily_summaries FOR SELECT
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can insert daily summaries"
  ON public.daily_summaries FOR INSERT
  WITH CHECK (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can update daily summaries"
  ON public.daily_summaries FOR UPDATE
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Admins can read all daily summaries"
  ON public.daily_summaries FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 10) graph_nodes
CREATE TABLE public.graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  label text NOT NULL,
  type text NOT NULL CHECK (type IN ('person','topic','event','emotion','habit','value','place','plan')),
  weight integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  UNIQUE(couple_id, label, type)
);

CREATE INDEX idx_graph_nodes_couple ON public.graph_nodes(couple_id);

ALTER TABLE public.graph_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Couple members can read their graph nodes"
  ON public.graph_nodes FOR SELECT
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can insert graph nodes"
  ON public.graph_nodes FOR INSERT
  WITH CHECK (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can update graph nodes"
  ON public.graph_nodes FOR UPDATE
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Admins can read all graph nodes"
  ON public.graph_nodes FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 11) graph_edges
CREATE TABLE public.graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  source_node_id uuid NOT NULL REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
  target_node_id uuid NOT NULL REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
  relation text NOT NULL CHECK (relation IN ('causes','relates_to','triggers','resolves','prefers','avoids','conflicts_with','supports')),
  weight integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb DEFAULT '[]'::jsonb,
  UNIQUE(couple_id, source_node_id, target_node_id, relation)
);

CREATE INDEX idx_graph_edges_couple ON public.graph_edges(couple_id);
CREATE INDEX idx_graph_edges_source ON public.graph_edges(source_node_id);
CREATE INDEX idx_graph_edges_target ON public.graph_edges(target_node_id);

ALTER TABLE public.graph_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Couple members can read their graph edges"
  ON public.graph_edges FOR SELECT
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can insert graph edges"
  ON public.graph_edges FOR INSERT
  WITH CHECK (couple_id = public.get_my_couple_id());

CREATE POLICY "Couple members can update graph edges"
  ON public.graph_edges FOR UPDATE
  USING (couple_id = public.get_my_couple_id());

CREATE POLICY "Admins can read all graph edges"
  ON public.graph_edges FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- REALTIME: Enable for messages, graph_nodes, graph_edges
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.graph_nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.graph_edges;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_days;

-- ============================================================
-- STORAGE: Create uploads bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Couple members can upload files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'uploads'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "Couple members can read own uploads"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'uploads'
    AND auth.uid() IS NOT NULL
  );
