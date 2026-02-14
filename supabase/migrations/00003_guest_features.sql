-- Add guest-related columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_online boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Create guest connection requests table
CREATE TABLE IF NOT EXISTS guest_connection_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  to_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE guest_connection_requests ENABLE ROW LEVEL SECURITY;

-- RLS policies for guest_connection_requests
CREATE POLICY "Users can view their own requests"
  ON guest_connection_requests
  FOR SELECT
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY "Users can create requests"
  ON guest_connection_requests
  FOR INSERT
  WITH CHECK (auth.uid() = from_user_id);

CREATE POLICY "Users can update requests sent to them"
  ON guest_connection_requests
  FOR UPDATE
  USING (auth.uid() = to_user_id);

-- Add profiles update policy for online status
CREATE POLICY "Users can update their own profile online status"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Enable realtime for guest_connection_requests
ALTER PUBLICATION supabase_realtime ADD TABLE guest_connection_requests;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_guest_requests_to_user ON guest_connection_requests(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_guest_requests_from_user ON guest_connection_requests(from_user_id, status);
CREATE INDEX IF NOT EXISTS idx_profiles_online ON profiles(is_online) WHERE is_online = true;
