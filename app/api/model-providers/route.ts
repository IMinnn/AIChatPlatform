import { NextResponse } from "next/server";
import { getModelProviders, writeModelProviders } from "@/lib/models";
import { ModelProviderConfig } from "@/lib/types";

export async function GET() {
  return NextResponse.json(await getModelProviders());
}

export async function PUT(request: Request) {
  const body = (await request.json()) as {
    providers?: ModelProviderConfig[];
  };

  if (!body.providers) {
    return new NextResponse("Providers are required", { status: 400 });
  }

  const providers = await writeModelProviders(body.providers);
  return NextResponse.json(providers);
}
