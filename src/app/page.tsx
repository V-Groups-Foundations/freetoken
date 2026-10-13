import Link from 'next/link';

export default function Home() {
  return (
    <section className="space-y-6 py-12">
      <h1 className="text-4xl font-bold tracking-tight">All your free AI quotas, one place.</h1>
      <p className="max-w-2xl text-lg text-neutral-600">
        Connect your own free API keys from Gemini, Groq, OpenRouter, Mistral, Cerebras, GitHub Models and
        Cloudflare. FreeToken routes every request to whichever of your providers still has free quota, in a
        chat UI or through your own OpenAI-compatible API.
      </p>
      <p className="text-sm text-neutral-500">Your keys are encrypted and only ever used for your own requests.</p>
      <Link href="/connect" className="inline-block rounded-lg bg-neutral-900 px-5 py-3 text-white">Get started</Link>
    </section>
  );
}
