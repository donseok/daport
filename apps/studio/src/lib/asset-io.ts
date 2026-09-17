import { list, put } from "@vercel/blob";
import type { BundleAsset } from "./bundle";

/** 에셋 저장소(Vercel Blob)가 설정됐는지. dev에서는 보통 없다 */
export function assetStorageEnabled(): boolean { return !!process.env.BLOB_READ_WRITE_TOKEN; }

const prefix = (id: string) => `assets/${id}-`;

export async function hasAsset(id: string): Promise<boolean> {
  return (await list({ prefix: prefix(id), limit: 1 })).blobs.length > 0;
}

/** 에셋 라우트와 같은 규칙으로 찾아 본문을 내려받는다. 없으면 null */
export async function fetchAsset(id: string): Promise<BundleAsset | null> {
  const blob = (await list({ prefix: prefix(id), limit: 1 })).blobs[0];
  if (!blob) return null;
  const res = await fetch(blob.url);
  if (!res.ok) return null;
  return { id, name: blob.pathname.slice(prefix(id).length), mime: res.headers.get("content-type") ?? "application/octet-stream", data: new Uint8Array(await res.arrayBuffer()) };
}

/** 같은 id로 올려 asset://id 참조를 보존한다 (업로드 라우트와 같은 pathname 규칙) */
export async function putAsset(a: BundleAsset): Promise<void> {
  await put(`${prefix(a.id)}${a.name}`, Buffer.from(a.data), { access: "public", addRandomSuffix: false, contentType: a.mime });
}
