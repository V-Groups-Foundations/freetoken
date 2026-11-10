'use client';

import { useState } from 'react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** A password box with a 👁 button to show what's typed — phones swap in suggested passwords or capitals. */
export function PasswordInput({ className, ...props }: Props) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={shown ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={`${className ?? 'input'} pr-12`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-lg text-[var(--muted)] hover:text-[var(--ink)]"
      >
        <span aria-hidden>{shown ? '🙈' : '👁'}</span>
      </button>
    </div>
  );
}
