'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app] render error', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">This screen could not load</h1>
      <p className="mt-3 text-muted-foreground">
        Nothing you have recorded is affected. Try again, and if it persists let us know.
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
