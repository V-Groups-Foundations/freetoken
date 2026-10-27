// Saved pictures: a row per image in generated_images, the bytes in one file per image under
// .data/images (IMAGES_DIR) — data URLs of ~1 MB each would bloat the database.

import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { generatedImages } from '@/db/schema';

export type ImageKind = 'create' | 'edit' | 'api';
export const imagesDir = () => process.env.IMAGES_DIR ?? path.resolve('.data', 'images');

/** Width and height from a JPEG's frame header or a PNG's IHDR; null for anything else. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const v = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (v.length > 24 && v.readUInt32BE(0) === 0x89504e47) return { width: v.readUInt32BE(16), height: v.readUInt32BE(20) };
  if (v.length < 4 || v[0] !== 0xff || v[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < v.length; ) {
    if (v[i] !== 0xff) return null;
    const marker = v[i + 1];
    const len = v.readUInt16BE(i + 2);
    // SOF0–SOF15 carry the size, except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: v.readUInt16BE(i + 5), width: v.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

export const imageType = (b: Uint8Array) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0x52 && b[8] === 0x57 ? 'image/webp' : 'image/jpeg');

export function dataUrlBytes(dataUrl: string): Buffer | null {
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl);
  return m ? Buffer.from(m[1], 'base64') : null;
}

export async function saveImage(
  db: DB,
  input: { userId: string; prompt: string; kind: ImageKind; engine: string; bytes: Uint8Array },
  dir = imagesDir(),
): Promise<string> {
  const id = randomUUID();
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${id}.img`), input.bytes);
  const size = imageSize(input.bytes);
  await db.insert(generatedImages).values({
    id, userId: input.userId, prompt: input.prompt.slice(0, 2000), kind: input.kind, engine: input.engine,
    width: size?.width ?? null, height: size?.height ?? null, bytes: input.bytes.length,
  });
  return id;
}

export async function listImages(db: DB, userId: string, limit = 60) {
  return db.select({
    id: generatedImages.id, prompt: generatedImages.prompt, kind: generatedImages.kind, engine: generatedImages.engine,
    width: generatedImages.width, height: generatedImages.height, createdAt: generatedImages.createdAt,
  }).from(generatedImages).where(eq(generatedImages.userId, userId)).orderBy(desc(generatedImages.createdAt)).limit(limit);
}

/** The picture's bytes, only for its owner. */
export async function readImage(db: DB, userId: string, id: string, dir = imagesDir()): Promise<{ bytes: Buffer; type: string } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await db.select({ id: generatedImages.id }).from(generatedImages)
    .where(and(eq(generatedImages.id, id), eq(generatedImages.userId, userId)));
  if (!row) return null;
  const bytes = await fsp.readFile(path.join(dir, `${id}.img`)).catch(() => null);
  return bytes ? { bytes, type: imageType(bytes) } : null;
}

export async function deleteImage(db: DB, userId: string, id: string, dir = imagesDir()): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  const gone = await db.delete(generatedImages).where(and(eq(generatedImages.id, id), eq(generatedImages.userId, userId))).returning({ id: generatedImages.id });
  if (!gone.length) return false;
  await fsp.rm(path.join(dir, `${id}.img`), { force: true });
  return true;
}
