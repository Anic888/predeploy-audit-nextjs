// This fixture is intentionally NOT a git repo. It exists to verify the
// scanner's filesystem-walker fallback path for C3: when git is not
// available, the scanner should still find hardcoded known-format
// secrets in tracked source via a directory walk.
//
// Expected: C3 finds the sk_live_ key on this line as one CRITICAL finding.
// Tail is exactly 20 chars (our C3 regex minimum), well below the real
// Stripe live-key length, so it cannot possibly authenticate.

const STRIPE_KEY = "sk_live_DEMOFAKEKEY12345QQQQ";

export function chargeCustomer(amount: number) {
  return { stripe: STRIPE_KEY, amount };
}
