import { blotatoFetch, BlotatoApiError } from "./client";
import {
  BlotatoAccountListSchema,
  type BlotatoAccount,
} from "./types";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import {
  mockListAccounts,
  mockGetAccount,
} from "@/lib/mocks/blotato";

export async function listAccounts(): Promise<BlotatoAccount[]> {
  if (shouldMockExternalApis()) return mockListAccounts();
  const response = await blotatoFetch("/users/me/accounts", BlotatoAccountListSchema);
  return response.items;
}

export async function getAccount(id: string): Promise<BlotatoAccount> {
  if (shouldMockExternalApis()) return mockGetAccount(id);
  const accounts = await listAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account) throw new BlotatoApiError(`Account ${id} not found`, 404);
  return account;
}
