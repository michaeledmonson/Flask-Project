import { NextResponse } from "next/server";
import { getFoodDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/foods/[slug] — food, active outbreaks with reports, and past events. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const detail = await getFoodDetail(slug);

  if (!detail) {
    return NextResponse.json({ error: "Food not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
