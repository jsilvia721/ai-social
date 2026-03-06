import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

export const config = {
  matcher: [
    // Protect everything except NextAuth routes, sign-in page, test helpers, and static assets
    "/((?!api/auth|api/test|auth/signin|_next/static|_next/image|favicon.ico).*)",
    // Protect all API routes except NextAuth and test-only helpers
    "/api/((?!auth|test).*)",
  ],
};
