// BUG (V5 / C6): this Stripe webhook handler reads the raw request body,
// imports the Stripe SDK, and dispatches on event.type — but never verifies
// the signature. The STRIPE_WEBHOOK_SECRET env var is declared but unused.
// Any unauthenticated HTTP client can POST a forged event to this endpoint
// and it will be processed as if it came from Stripe. Directly mirrors
// the pattern behind CVE-2026-21894 (n8n).
//
// The fix instructions live in EXPECTED_FINDINGS.md and in the scanner's
// own output for C6 — we deliberately keep the "right way" code out of
// this file so the regression target stays unambiguous.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20"
});

export async function POST(request: Request) {
  const rawBody = await request.text();

  // No signature verification of any kind. We just parse the body and trust it.
  const event = JSON.parse(rawBody);

  switch (event.type) {
    case "checkout.session.completed": {
      // Pretend we upgrade the user to Pro here.
      const session = event.data.object;
      console.log("upgrading user", session.client_reference_id);
      break;
    }
    case "customer.subscription.deleted": {
      console.log("downgrading user");
      break;
    }
  }

  // We never even use the stripe variable; silence the TS unused warning.
  void stripe;

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
