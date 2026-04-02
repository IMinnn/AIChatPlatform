import { NextResponse } from "next/server";
import { getPublicModels } from "@/lib/models";

export async function GET() {
  return NextResponse.json(await getPublicModels());
}
