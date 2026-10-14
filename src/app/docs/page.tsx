import Link from 'next/link';
import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listKeys } from '@/keys/service';
import { listDocuments } from '@/rag/service';
import { EMBEDDING_PROVIDERS } from '@/router/modalities';
import { DocsClient } from './docs';

export default async function DocsPage() {
  const uid = await requireUserId();
  const db = getDb();
  const keys = await listKeys(db, uid);
  const embedProviders = new Set(EMBEDDING_PROVIDERS.map((e) => e.provider));
  const hasEmbedder = keys.some((k) => k.status === 'valid' && embedProviders.has(k.provider as never));

  if (!hasEmbedder) {
    return (
      <div className="card card-pad">
        <h2 className="font-semibold">Document search needs an embedder</h2>
        <p className="muted mt-1 text-sm">
          Upload documents and ask questions grounded in them. This uses Gemini&apos;s free embeddings.{' '}
          <Link href="/connect" className="font-medium text-[var(--brand)] hover:underline">Connect Gemini</Link> to start.
        </p>
      </div>
    );
  }

  const docs = await listDocuments(db, uid);
  return <DocsClient initialDocs={docs.map((d) => ({ id: d.id, name: d.name, chunkCount: d.chunkCount }))} />;
}
