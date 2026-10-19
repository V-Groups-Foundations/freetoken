'use client';

import { useEffect, useRef } from 'react';

/** Submits the sign-in form as soon as the page loads; the button is there if scripts are slow. */
export function AutoSubmit({ action, token }: { action: (fd: FormData) => Promise<void>; token: string }) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.requestSubmit(); }, []);
  return (
    <form ref={form} action={action}>
      <input type="hidden" name="t" value={token} />
      <button className="btn btn-primary">Continue</button>
    </form>
  );
}
