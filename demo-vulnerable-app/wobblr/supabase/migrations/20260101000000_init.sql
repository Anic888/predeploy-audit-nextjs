-- Wobblr initial schema.
--
-- BUG (V6 / C7): public.profiles is created here without RLS being
-- enabled anywhere in the migrations directory. Anyone with the anon
-- key can read or write every row. Mirrors CVE-2025-48757 (170+
-- Lovable-generated apps exposed by missing RLS).

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  username text UNIQUE NOT NULL,
  bio text,
  is_pro boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX profiles_username_idx ON public.profiles(username);
