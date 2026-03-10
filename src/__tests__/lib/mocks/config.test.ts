import { shouldMockExternalApis } from "@/lib/mocks/config";

describe("shouldMockExternalApis", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns true when MOCK_EXTERNAL_APIS=true", () => {
    process.env.MOCK_EXTERNAL_APIS = "true";
    expect(shouldMockExternalApis()).toBe(true);
  });

  it("returns false when MOCK_EXTERNAL_APIS=false", () => {
    process.env.MOCK_EXTERNAL_APIS = "false";
    expect(shouldMockExternalApis()).toBe(false);
  });

  it("returns true in development when env var is not set", () => {
    delete process.env.MOCK_EXTERNAL_APIS;
    (process.env as any).NODE_ENV = "development";
    expect(shouldMockExternalApis()).toBe(true);
  });

  it("returns true in test when env var is not set", () => {
    delete process.env.MOCK_EXTERNAL_APIS;
    (process.env as any).NODE_ENV = "test";
    expect(shouldMockExternalApis()).toBe(true);
  });

  it("returns false in production when env var is not set", () => {
    delete process.env.MOCK_EXTERNAL_APIS;
    (process.env as any).NODE_ENV = "production";
    expect(shouldMockExternalApis()).toBe(false);
  });

  it("explicit true overrides production NODE_ENV", () => {
    process.env.MOCK_EXTERNAL_APIS = "true";
    (process.env as any).NODE_ENV = "production";
    expect(shouldMockExternalApis()).toBe(true);
  });

  it("explicit false overrides development NODE_ENV", () => {
    process.env.MOCK_EXTERNAL_APIS = "false";
    (process.env as any).NODE_ENV = "development";
    expect(shouldMockExternalApis()).toBe(false);
  });
});
