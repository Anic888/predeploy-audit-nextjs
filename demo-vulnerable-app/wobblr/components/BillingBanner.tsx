"use client";

// DECOY (D2): a client component that correctly uses the Stripe
// PUBLISHABLE key. The scanner must NOT flag this for C4:
//   - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY contains "PUBLISHABLE"
//     which is on the C4 name allowlist.
//   - The value in .env.local starts with pk_live_, which is a
//     publishable (public) key format, not a secret format.

export function BillingBanner() {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  if (!publishableKey) return null;

  return (
    <div
      style={{
        border: "1px solid #eee",
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 13,
        color: "#555"
      }}
    >
      Upgrade to Pro to unlock AI-written bios.
    </div>
  );
}
