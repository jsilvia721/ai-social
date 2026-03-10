import { env } from "@/env";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: AuthOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: "jwt" },
  secret: env.NEXTAUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const allowed = env.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase());
      if (!allowed.includes((user.email ?? "").toLowerCase())) return false;
      // Sync admin status from ADMIN_EMAILS on every sign-in (promote or demote)
      if (user.id) {
        const adminEmails = env.ADMIN_EMAILS
          ? env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase())
          : [];
        const shouldBeAdmin = adminEmails.includes((user.email ?? "").toLowerCase());
        await prisma.user.updateMany({ where: { id: user.id }, data: { isAdmin: shouldBeAdmin } });
      }
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.sub = user.id;
        // On sign-in: resolve the user's active business and admin status
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { activeBusinessId: true, isAdmin: true },
        });
        token.isAdmin = dbUser?.isAdmin ?? false;
        if (dbUser?.activeBusinessId) {
          token.activeBusinessId = dbUser.activeBusinessId;
        } else {
          // Fall back to first business the user belongs to
          const membership = await prisma.businessMember.findFirst({
            where: { userId: user.id },
            orderBy: { joinedAt: "asc" },
          });
          token.activeBusinessId = membership?.businessId ?? null;
        }
      } else if (token.sub && token.email) {
        // Token refresh: verify the stored user ID still exists (guards against DB resets in dev).
        // If stale, look up by email and self-heal the token so the user doesn't need to sign out.
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { id: true, isAdmin: true },
        });
        if (!dbUser) {
          const byEmail = await prisma.user.findUnique({
            where: { email: token.email as string },
            select: { id: true, activeBusinessId: true, isAdmin: true },
          });
          if (byEmail) {
            token.sub = byEmail.id;
            token.activeBusinessId = byEmail.activeBusinessId ?? null;
            token.isAdmin = byEmail.isAdmin ?? false;
          }
        } else {
          // Keep admin status in sync with DB (e.g. after ADMIN_EMAILS changes)
          token.isAdmin = dbUser.isAdmin ?? false;
        }
      }
      // Client can trigger a session update via update({ activeBusinessId })
      if (trigger === "update" && typeof session?.activeBusinessId === "string") {
        token.activeBusinessId = session.activeBusinessId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.sub && session.user) {
        session.user.id = token.sub;
        session.user.activeBusinessId = (token.activeBusinessId as string | null) ?? null;
        session.user.isAdmin = (token.isAdmin as boolean) ?? false;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
};
