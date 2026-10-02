import { type NextRequest } from 'next/server'
import { gateRequest } from '@/lib/http/requestGate'
import { withSecurityHeaders } from '@/lib/http/securityHeaders'

export async function proxy(request: NextRequest) {
  return withSecurityHeaders(await gateRequest(request), request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
