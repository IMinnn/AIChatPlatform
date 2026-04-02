import { NextResponse } from "next/server";
import { updateState } from "@/lib/fs-db";
import { deleteManagedAvatarFile, saveAvatarFile } from "@/lib/avatar-storage";
import { Settings } from "@/lib/types";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return new NextResponse("缺少头像文件", { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return new NextResponse("请选择图片文件", { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const avatarPath = await saveAvatarFile(Buffer.from(arrayBuffer), file.type);

  let settings: Settings | null = null;
  let previousAvatar = "";
  await updateState((state) => {
    previousAvatar = state.settings.userAvatar;
    settings = {
      ...state.settings,
      userAvatar: avatarPath
    };
    return {
      ...state,
      settings: settings!
    };
  });

  if (previousAvatar && previousAvatar !== avatarPath) {
    await deleteManagedAvatarFile(previousAvatar);
  }

  return NextResponse.json(settings!);
}
