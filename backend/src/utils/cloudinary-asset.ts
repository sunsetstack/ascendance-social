export function resolveOwnedCloudinaryAsset(
  value: string,
  ownerPublicId: string,
  cloudName: string | undefined,
): string | null {
  if (!cloudName || !/^[A-Za-z0-9_-]+$/.test(ownerPublicId)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" ||
      url.port || url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
    if (parts.some((part) => !part || part.includes("/") || part.includes("\\") || part === "." || part === "..")) return null;
    if (parts[0] !== cloudName || parts[1] !== "image" || parts[2] !== "upload") return null;
    const asset = parts.slice(3);
    if (/^v\d+$/.test(asset[0] ?? "")) asset.shift();
    if (asset.length !== 2 || asset[0] !== ownerPublicId) return null;
    const file = /^([A-Za-z0-9_-]+)\.[A-Za-z0-9]+$/.exec(asset[1]!);
    return file ? `${ownerPublicId}/${file[1]}` : null;
  } catch {
    return null;
  }
}
