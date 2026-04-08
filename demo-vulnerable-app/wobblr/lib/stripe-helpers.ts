// DECOY (D5): a helper file that demonstrates the CORRECT Stripe
// signature verification pattern. The scanner must NOT flag this for
// C6 because:
//   - File path does not match the webhook file-path gate
//     (**/api/**webhook**, **/api/stripe/**, **/webhooks/stripe/**).
//   - Even if it did, constructEvent is clearly called in the same file.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20"
});

export function verifyStripeEvent(rawBody: string, signatureHeader: string) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signatureHeader,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
}
