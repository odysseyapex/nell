import Link from 'next/link';
import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in to Nellvia</CardTitle>
        <CardDescription>Coaches and clients use the same door.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next} />
        <p className="mt-6 text-sm text-muted-foreground">
          New here?{' '}
          <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
            Create a coaching workspace
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
