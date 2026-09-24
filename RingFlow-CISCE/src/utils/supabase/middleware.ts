import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const host = request.headers.get('host') || ''
  
  // ─── Public Tunnel Ingress Isolation (Cloudflare Tunnel / ngrok) ─────────
  // If the request originates from an external tunnel domain, strictly permit
  // ONLY /judge/*, /api/judge/*, /api/live, and static assets.
  // Administrative routes (/admin, /moderator, /organiser, /stager) are physically blocked.
  const isTunnel =
    host.startsWith('judge.') ||
    host.includes('trycloudflare.com') ||
    host.includes('ngrok-free.app') ||
    host.includes('loca.lt')

  if (isTunnel) {
    const isPublicAllowed =
      pathname.startsWith('/judge') ||
      pathname.startsWith('/api/judge') ||
      pathname.startsWith('/api/live') ||
      pathname.startsWith('/_next') ||
      pathname === '/favicon.ico' ||
      pathname === '/icon.png' ||
      pathname === '/apple-icon.png'

    if (!isPublicAllowed) {
      return new NextResponse(
        'Access Denied (HTTP 403): Administrative and table official consoles are strictly restricted to the Venue LAN.',
        { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      )
    }
  }

  // ─── Organiser routes: cookie-only auth, zero network calls in middleware ────
  // Real session validation happens in ensureOrganiserHasAccessToTournament()
  // inside each server action / page, which runs on the server with full DB access.
  if (pathname.startsWith('/organiser')) {
    const isWaitingRoom = pathname.startsWith('/organiser/waiting')
    const orgToken = request.cookies.get('org_token')?.value
    const hasAuthCookie = request.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))

    if (!isWaitingRoom && !orgToken && !hasAuthCookie) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }

    return NextResponse.next({ request })
  }

  // ─── Stager routes: cookie-only auth, zero network calls in middleware ────
  // Real session validation happens in ensureStagerHasAccessToTournament()
  if (pathname.startsWith('/stager')) {
    const isWaitingRoom = pathname.startsWith('/stager/waiting')
    const stagerToken = request.cookies.get('stager_token')?.value

    if (!isWaitingRoom && !stagerToken) {
      const url = request.nextUrl.clone()
      url.pathname = '/login/stager'
      return NextResponse.redirect(url)
    }

    return NextResponse.next({ request })
  }

  // ─── Moderator routes: cookie-only auth, zero network calls in middleware ────
  // Real session validation happens in validateModeratorSession() in each action.
  if (pathname.startsWith('/moderator')) {
    const isWaitingRoom = pathname.startsWith('/moderator/waiting')
    const modToken = request.cookies.get('mod_token')?.value

    if (!isWaitingRoom && !modToken) {
      const url = request.nextUrl.clone()
      url.pathname = '/login/mod'
      return NextResponse.redirect(url)
    }

    return NextResponse.next({ request })
  }

  // ─── Admin routes: cookie-based session auth, zero external network calls ─
  if (pathname.startsWith('/admin')) {
    const adminSession = request.cookies.get('admin_session')?.value || request.cookies.get('admin_dev_id')?.value
    if (!adminSession) {
      const url = request.nextUrl.clone()
      url.pathname = '/login/admin'
      return NextResponse.redirect(url)
    }

    return NextResponse.next({ request })
  }

  if (pathname === '/login/admin') {
    const adminSession = request.cookies.get('admin_session')?.value || request.cookies.get('admin_dev_id')?.value
    if (adminSession) {
      const url = request.nextUrl.clone()
      url.pathname = '/admin'
      return NextResponse.redirect(url)
    }

    return NextResponse.next({ request })
  }

  // ─── All other routes: pass through with no network calls ─────────────────
  return NextResponse.next({ request })
}
