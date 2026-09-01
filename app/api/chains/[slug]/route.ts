import { NextResponse } from "next/server";
import { getChainDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/chains/[slug] — chain with evidence grouped by signal type (§7). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const detail = await getChainDetail(slug);

  if (!detail) {
    return NextResponse.json({ error: "Chain not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
