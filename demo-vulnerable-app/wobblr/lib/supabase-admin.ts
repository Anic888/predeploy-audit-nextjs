// DECOY (D7 — tri-state test): this file lives under lib/ with no
// directive, which means the scanner's classification is "ambiguous".
// It references SUPABASE_SERVICE_ROLE_KEY, so it matches C5's watched
// pattern. Under the Q2 strict rule, the scanner must emit an
// UNCERTAIN manual-check item here — NOT a hard CRITICAL finding.
//
// In a real app, the dev would either add "server-only" as an import
// or add a // @predeploy-ignore: server-only-wrapper comment after
// confirming this file is only imported from server code. We
// deliberately do neither so the tri-state path is exercised.

import { createClient } from "@supabase/supabase-js";

export function makeSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
