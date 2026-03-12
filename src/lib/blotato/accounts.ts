import { z } from "zod";
import { blotatoFetch } from "./client";
import { BlotatoApiError } from "./client";
import {
  BlotatoAccountSchema,
  type BlotatoAccount,
} from "./types";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import {
  mockListAccounts,
  mockGetAccount,
} from "@/lib/mocks/blotato";

export async function listAccounts(): Promise<BlotatoAccount[]> {
  if (shouldMockExternalApis()) return mockListAccounts();
  return blotatoFetch("/users/me/accounts", z.array(BlotatoAccountSchema));
}

export async function getAccount(id: string): Promise<BlotatoAccount> {
  if (shouldMockExternalApis()) return mockGetAccount(id);
  const accounts = await listAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account) throw new BlotatoApiError(`Account ${id} not found`, 404);
  return account;
}
