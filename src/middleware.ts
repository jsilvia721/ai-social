import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

export const config = {
  matcher: [
    // Protect everything except NextAuth routes, the sign-in page, and static assets
    "/((?!api/auth|auth/signin|_next/static|_next/image|favicon.ico).*)",
    // Protect all API routes except NextAuth itself
    "/api/((?!auth).*)",
  ],
};
