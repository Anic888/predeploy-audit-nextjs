// DECOY (D3): public profile page. Server component (no directive).
// Uses the Supabase ANON key, which is intentionally public. The
// scanner must NOT flag this file for C5 (no SERVICE_ROLE reference)
// or C4 (NEXT_PUBLIC_SUPABASE_ANON_KEY is on the allowlist).

import { createClient } from "@supabase/supabase-js";

async function getProfile(username: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await supabase
    .from("profiles")
    .select("username,bio,is_pro")
    .eq("username", username)
    .single();
  return data as { username: string; bio: string | null; is_pro: boolean } | null;
}

export default async function PublicProfile({
  params
}: {
  params: { username: string };
}) {
  const profile = await getProfile(params.username);

  if (!profile) {
    return (
      <main>
        <h1>Not found</h1>
        <p>No profile for {params.username}.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>
        {profile.username} {profile.is_pro ? "⭐" : ""}
      </h1>
      <p>{profile.bio ?? "No bio yet."}</p>
    </main>
  );
}
