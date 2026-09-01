import { NextResponse } from "next/server";
import { getFoodList } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/foods?q=&state=&category= — risk-ranked grocery list (DESIGN.md §8). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const foods = await getFoodList({
    q: params.get("q") ?? undefined,
    state: params.get("state") ?? undefined,
    category: params.get("category") ?? undefined,
  });

  return NextResponse.json(foods);
}
