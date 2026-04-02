import { NextResponse } from "next/server";
import { deleteManagedAvatarFile } from "@/lib/avatar-storage";
import { readState, updateState } from "@/lib/fs-db";
import { getPreferredModelId } from "@/lib/models";
import { Settings } from "@/lib/types";

export async function GET() {
  const state = await readState();
  const defaultModelId = await getPreferredModelId(state.settings.defaultModelId);
  if (defaultModelId !== state.settings.defaultModelId) {
    await updateState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        defaultModelId
      }
    }));
  }
  return NextResponse.json({
    ...state.settings,
    defaultModelId
  });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<Settings>;
  let settings: Settings | null = null;
  let previousAvatar = "";
  const resolvedDefaultModelId =
    body.defaultModelId === undefined ? undefined : await getPreferredModelId(body.defaultModelId);

  await updateState((state) => {
    previousAvatar = state.settings.userAvatar;
    settings = {
      ...state.settings,
      ...body,
      ...(resolvedDefaultModelId ? { defaultModelId: resolvedDefaultModelId } : {})
    };
    return { ...state, settings: settings! };
  });

  if (body.userAvatar === "" && previousAvatar) {
    await deleteManagedAvatarFile(previousAvatar);
  }

  return NextResponse.json(settings!);
}
