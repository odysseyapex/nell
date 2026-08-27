import { type NextRequest, NextResponse } from 'next/server';
import { type CookieOptions, createServerClient } from '@supabase/ssr';

/**
 * Session refresh and a coarse authentication gate.
 *
 * Middleware only answers "is there a signed-in user?". It deliberately does
 * not make role or tenancy decisions: those need the profile row, and putting
 * authorization in two places is how the two end up disagreeing. Role checks
 * live in the page and route guards, backed by RLS in the database.
 */

const PROTECTED_PREFIXES = ['/app', '/admin', '/onboarding'];
const AUTH_ROUTES = ['/login', '/signup'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Development harness: /demo issues the session cookie and the page guards
  // handle the rest, so there is nothing here to refresh.
  if (process.env.NELL_DEMO_MODE === '1') return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));

  // If Supabase is not configured we cannot verify a session — so there is no
  // session. Protected routes are refused rather than rendered, which fails
  // closed and keeps the behaviour identical to a signed-out visitor.
  if (!url || !anonKey) {
    if (!isProtected) return response;
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('next', path);
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtected) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('next', path);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && AUTH_ROUTES.includes(path)) {
    return NextResponse.redirect(new URL('/app', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files — matching those would
     * add a Supabase round trip to every icon request.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
