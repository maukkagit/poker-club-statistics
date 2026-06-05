import { NextResponse } from "next/server";
import { computePlayerStats, computeCumulativeSeries } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  const [stats, series] = await Promise.all([computePlayerStats(), computeCumulativeSeries()]);
  return NextResponse.json({ stats, series });
}
