import { getServerSession } from "next-auth/next";

export const mockSession = {
  user: {
    id: "user-test-id",
    email: "test@example.com",
    name: "Test User",
  },
  expires: new Date(Date.now() + 86400 * 1000).toISOString(),
};

export function mockAuthenticated(session = mockSession) {
  (getServerSession as jest.Mock).mockResolvedValue(session);
}

export function mockUnauthenticated() {
  (getServerSession as jest.Mock).mockResolvedValue(null);
}
