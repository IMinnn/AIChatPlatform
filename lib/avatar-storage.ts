import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const avatarPublicDir = path.join(process.cwd(), "public", "uploads", "avatars");
const avatarPublicPathPrefix = "/uploads/avatars/";

function getExtensionFromMimeType(mimeType: string) {
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "image/gif") {
    return ".gif";
  }
  if (mimeType === "image/svg+xml") {
    return ".svg";
  }
  return ".png";
}

export function isManagedAvatarPath(value: string) {
  return value.startsWith(avatarPublicPathPrefix);
}

export async function saveAvatarFile(buffer: Buffer, mimeType: string) {
  await mkdir(avatarPublicDir, { recursive: true });
  const fileName = `user-avatar-${Date.now()}${getExtensionFromMimeType(mimeType)}`;
  const absolutePath = path.join(avatarPublicDir, fileName);
  await writeFile(absolutePath, buffer);
  return `${avatarPublicPathPrefix}${fileName}`;
}

export async function deleteManagedAvatarFile(value: string) {
  if (!isManagedAvatarPath(value)) {
    return;
  }

  const fileName = value.slice(avatarPublicPathPrefix.length).split("?")[0];
  if (!fileName) {
    return;
  }

  const absolutePath = path.join(avatarPublicDir, fileName);
  try {
    await unlink(absolutePath);
  } catch {
    // Ignore missing files.
  }
}
