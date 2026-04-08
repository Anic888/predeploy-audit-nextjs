// Test file with a hardcoded test-key. C3 should suppress this from
// findings (it's a test file) but increment the test-file count in
// the summary line.
//
// Tail is exactly 20 chars (our C3 regex minimum), well below the real
// Stripe live-key length, so it cannot possibly authenticate.

const TEST_STRIPE_KEY = "sk_live_DEMOFAKEKEY12345QQQQ";

export function setupBillingTest() {
  return { stripe: TEST_STRIPE_KEY };
}
