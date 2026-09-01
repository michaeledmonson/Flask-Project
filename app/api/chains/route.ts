import { NextResponse } from "next/server";
import { getChainList } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/chains?state= — risk-ranked restaurant chains (DESIGN.md §8). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const chains = await getChainList({
    state: params.get("state") ?? undefined,
    q: params.get("q") ?? undefined,
  });

  return NextResponse.json(chains);
}
