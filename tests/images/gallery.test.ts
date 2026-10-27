import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb, createUser } from '../helpers/db';
import { deleteImage, imageSize, imageType, listImages, readImage, saveImage } from '@/images/gallery';

// a JPEG header with a baseline frame (SOF0) saying 640×480
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.from([0, 0, 1, 0, 0, 0, 0, 200]), Buffer.alloc(8)]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ft-gallery-'));

describe('imageSize / imageType', () => {
  it('reads JPEG and PNG sizes', () => {
    expect(imageSize(jpeg)).toEqual({ width: 640, height: 480 });
    expect(imageSize(png)).toEqual({ width: 256, height: 200 });
    expect(imageSize(Buffer.from('hello'))).toBeNull();
    expect(imageType(png)).toBe('image/png');
    expect(imageType(jpeg)).toBe('image/jpeg');
  });
});

describe('gallery', () => {
  it('saves, lists newest first, reads and deletes — only for the owner', async () => {
    const db = await createTestDb();
    const dir = tmp();
    const me = await createUser(db);
    const other = await createUser(db);
    const a = await saveImage(db, { userId: me.id, prompt: 'a fox', kind: 'create', engine: 'cloudflare', bytes: jpeg }, dir);
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveImage(db, { userId: me.id, prompt: 'the fox in a suit', kind: 'edit', engine: 'cloudflare', bytes: png }, dir);

    const list = await listImages(db, me.id);
    expect(list.map((i) => i.id)).toEqual([b, a]);
    expect(list[1]).toMatchObject({ prompt: 'a fox', kind: 'create', width: 640, height: 480 });
    expect(await listImages(db, other.id)).toEqual([]);

    expect(await readImage(db, me.id, a, dir)).toEqual({ bytes: jpeg, type: 'image/jpeg' });
    expect(await readImage(db, other.id, a, dir)).toBeNull();
    expect(await readImage(db, me.id, '../../etc/passwd', dir)).toBeNull();

    expect(await deleteImage(db, other.id, a, dir)).toBe(false);
    expect(await deleteImage(db, me.id, a, dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, `${a}.img`))).toBe(false);
    expect((await listImages(db, me.id)).map((i) => i.id)).toEqual([b]);
  });
});
