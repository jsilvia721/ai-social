export const metadata = {
  title: "Privacy Policy – AI Social",
};

export default function PrivacyPage() {
  const lastUpdated = "March 7, 2026";

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 py-16 px-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50">Privacy Policy</h1>
          <p className="text-zinc-500 mt-2 text-sm">Last updated: {lastUpdated}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-100">Overview</h2>
          <p>
            AI Social is a private social media management tool operated for internal use
            by a small, authorized team. This policy describes what data we collect, how
            we use it, and how it is protected.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-100">Data We Collect</h2>
          <ul className="list-disc list-inside space-y-2 text-zinc-400">
            <li>
              <span className="text-zinc-300">Account information</span> — your name and
              email address from Google OAuth sign-in.
            </li>
            <li>
              <span className="text-zinc-300">Social platform tokens</span> — OAuth access
              tokens for connected social accounts (Twitter/X, Instagram, Facebook,
              TikTok, YouTube). Tokens are encrypted at rest using AES-256-GCM.
            </li>
            <li>
              <span className="text-zinc-300">Post content</span> — text and media you
              create within the app for scheduling and publishing.
            </li>
            <li>
              <span className="text-zinc-300">Engagement metrics</span> — publicly
              available performance data (likes, views, shares) fetched from connected
              platforms.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-100">How We Use Your Data</h2>
          <ul className="list-disc list-inside space-y-2 text-zinc-400">
            <li>To authenticate you and control access to the application.</li>
            <li>To publish scheduled posts to your connected social accounts on your behalf.</li>
            <li>To display engagement metrics within the dashboard.</li>
          </ul>
          <p>
            We do not sell, share, or disclose your data to third parties. Data is used
            solely to operate the features of this application.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-100">Data Storage & Security</h2>
          <p>
            All data is stored in a private PostgreSQL database. OAuth tokens are encrypted
            before storage. Access to the application is restricted to a pre-approved list
            of email addresses.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-100">Third-Party Services</h2>
          <p>
            This application connects to the following third-party APIs on your behalf:
            Twitter/X API, Meta Graph API (Instagram &amp; Facebook), TikTok API, and
            YouTube Data API. Your use of those platforms is governed by their respective
            privacy policies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-100">Data Deletion</h2>
          <p>
            You can disconnect any social account at any time from the Accounts page, which
            removes the associated access tokens from our database. To request full deletion
            of your data, contact the app administrator.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-100">Contact</h2>
          <p>
            For any privacy-related questions, contact:{" "}
            <a
              href="mailto:jsilvia721@gmail.com"
              className="text-violet-400 hover:underline"
            >
              jsilvia721@gmail.com
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
