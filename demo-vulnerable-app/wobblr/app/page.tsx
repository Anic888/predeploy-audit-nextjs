// Landing page. Server component (no "use client" directive).
// Contains no credentials of any kind — this is just a decoy page
// to make the demo look like a real app.

export default function LandingPage() {
  return (
    <main>
      <h1>Wobblr</h1>
      <p>Claim your username. Upgrade to Pro for AI-written bios.</p>
      <ul>
        <li>
          <a href="/u/demo">See a public profile →</a>
        </li>
        <li>
          <a href="/dashboard">Dashboard (requires sign-in)</a>
        </li>
      </ul>
      <hr />
      <p style={{ color: "#888", fontSize: 13 }}>
        Demo app. Not intended for production use.
      </p>
    </main>
  );
}
