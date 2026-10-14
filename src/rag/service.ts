import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { docChunks, documents } from '@/db/schema';

export interface NewDocument {
  name: string;
  chars: number;
  chunkCount: number;
  embedProvider: string;
  embedModel: string;
}

export async function createDocument(db: DB, userId: string, doc: NewDocument): Promise<string> {
  const [row] = await db.insert(documents).values({ userId, ...doc }).returning({ id: documents.id });
  return row.id;
}

export async function insertChunks(
  db: DB,
  documentId: string,
  chunks: { chunkIndex: number; content: string; embedding: number[] }[],
): Promise<void> {
  if (chunks.length === 0) return;
  await db.insert(docChunks).values(
    chunks.map((c) => ({ documentId, chunkIndex: c.chunkIndex, content: c.content, embedding: JSON.stringify(c.embedding) })),
  );
}

export async function listDocuments(db: DB, userId: string) {
  return db
    .select({
      id: documents.id,
      name: documents.name,
      chars: documents.chars,
      chunkCount: documents.chunkCount,
      embedModel: documents.embedModel,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(documents.createdAt);
}

export async function deleteDocument(db: DB, userId: string, id: string): Promise<boolean> {
  const [row] = await db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)));
  if (!row) return false;
  await db.delete(documents).where(eq(documents.id, id)); // chunks cascade
  return true;
}

export interface LoadedChunk {
  documentId: string;
  documentName: string;
  content: string;
  embedding: number[];
}

/** Every chunk belonging to this user, with embeddings parsed, ready for cosine search. */
export async function loadUserChunks(db: DB, userId: string): Promise<LoadedChunk[]> {
  const rows = await db
    .select({
      documentId: docChunks.documentId,
      documentName: documents.name,
      content: docChunks.content,
      embedding: docChunks.embedding,
    })
    .from(docChunks)
    .innerJoin(documents, eq(docChunks.documentId, documents.id))
    .where(eq(documents.userId, userId));

  const out: LoadedChunk[] = [];
  for (const r of rows) {
    try {
      const embedding = JSON.parse(r.embedding) as number[];
      if (Array.isArray(embedding) && embedding.length) {
        out.push({ documentId: r.documentId, documentName: r.documentName, content: r.content, embedding });
      }
    } catch {
      // Skip a corrupt row rather than failing the whole search.
    }
  }
  return out;
}
