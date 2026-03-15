import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

export const config = {
  matcher: [
    // Protect everything except NextAuth routes, sign-in page, privacy page, test helpers, and static assets
    "/((?!api/auth|api/test|api/health|api/errors|api/webhooks|auth/signin|privacy|_next/static|_next/image|favicon.ico).*)",
    // Protect all API routes except NextAuth, test-only helpers, health check, error reporting, and webhooks
    "/api/((?!auth|test|health|errors|webhooks).*)",
  ],
};
