import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-3 text-muted-foreground">
        This page does not exist, or it belongs to a workspace you do not have access to.
      </p>
      <Button className="mt-6" asChild>
        <Link href="/app">Back to Nellvia</Link>
      </Button>
    </div>
  );
}
