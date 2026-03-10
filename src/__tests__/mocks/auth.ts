import { getServerSession } from "next-auth/next";

export const mockSession = {
  user: {
    id: "user-test-id",
    email: "test@example.com",
    name: "Test User",
    isAdmin: false,
    activeBusinessId: "biz-1",
  },
  expires: new Date(Date.now() + 86400 * 1000).toISOString(),
};

export const mockAdminSession = {
  user: {
    id: "admin-test-id",
    email: "admin@example.com",
    name: "Admin User",
    isAdmin: true,
    activeBusinessId: "biz-1",
  },
  expires: new Date(Date.now() + 86400 * 1000).toISOString(),
};

export function mockAuthenticated(session = mockSession) {
  (getServerSession as jest.Mock).mockResolvedValue(session);
}

export function mockAuthenticatedAsAdmin() {
  (getServerSession as jest.Mock).mockResolvedValue(mockAdminSession);
}

export function mockUnauthenticated() {
  (getServerSession as jest.Mock).mockResolvedValue(null);
}
