"use client";

// BUG (V4 / C5): this file starts with "use client", which means every
// import and every env var reference in it is embedded into the client
// JavaScript bundle at build time. Referencing SUPABASE_SERVICE_ROLE_KEY
// from a client-reachable file gives any visitor unrestricted access to
// the entire database, bypassing all Row-Level Security.
//
// The dev wrote this because they wanted a single "fetch all my data"
// call and thought service-role would "just work" from the dashboard.

import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Profile = {
  id: string;
  username: string;
  bio: string | null;
  is_pro: boolean;
};

export default function DashboardPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    supabaseAdmin
      .from("profiles")
      .select("*")
      .then(({ data }) => {
        if (data) setProfiles(data as Profile[]);
      });
  }, []);

  return (
    <main>
      <h1>Dashboard</h1>
      <p>
        Pretending to show your data. In reality this would leak every row
        to every visitor — see EXPECTED_FINDINGS.md, C5.
      </p>
      <ul>
        {profiles.map((p) => (
          <li key={p.id}>
            {p.username} {p.is_pro ? "(Pro)" : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
