import { NextResponse } from "next/server";
import {
  shouldMockExternalApis,
  setMockOverride,
  getMockOverride,
} from "@/lib/mocks/config";

function devOnly() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  return null;
}

/** GET — current mock mode state */
export async function GET() {
  const blocked = devOnly();
  if (blocked) return blocked;

  return NextResponse.json({
    mocking: shouldMockExternalApis(),
    override: getMockOverride(),
  });
}

/** POST — toggle mock mode. Body: { mock: true|false|null } */
export async function POST(request: Request) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const mock = body.mock === null ? null : !!body.mock;
  const mocking = setMockOverride(mock);

  return NextResponse.json({ mocking, override: getMockOverride() });
}
