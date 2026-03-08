import { z } from "zod";
import { blotatoFetch } from "./client";
import {
  BlotatoAccountSchema,
  BlotatoConnectUrlSchema,
  type BlotatoAccount,
} from "./types";

export async function getConnectUrl(
  platform: string,
  callbackUrl: string,
  state: string,
): Promise<{ url: string }> {
  return blotatoFetch(
    "/connect/url",
    BlotatoConnectUrlSchema,
    {
      method: "POST",
      body: JSON.stringify({ platform, callbackUrl, state }),
    },
  );
}

export async function listAccounts(): Promise<BlotatoAccount[]> {
  return blotatoFetch("/accounts", z.array(BlotatoAccountSchema));
}

export async function getAccount(id: string): Promise<BlotatoAccount> {
  return blotatoFetch(`/accounts/${id}`, BlotatoAccountSchema);
}
