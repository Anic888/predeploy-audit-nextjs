// DECOY (D6): a component file under components/ WITHOUT any directive.
// Under the Q2 strict classification rule, this file is "ambiguous".
// But the scanner must NOT emit any C5 finding or manual-check for it,
// because it does NOT reference SUPABASE_SERVICE_ROLE_KEY. Ambiguous
// classification only matters when combined with a watched pattern.

type Props = {
  bio: string | null;
};

export function UserBio({ bio }: Props) {
  if (!bio) return <p style={{ color: "#888" }}>No bio yet.</p>;
  return <p>{bio}</p>;
}
