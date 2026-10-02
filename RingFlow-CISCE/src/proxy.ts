import { type NextRequest } from 'next/server'
import { gateRequest } from '@/lib/http/requestGate'

export async function proxy(request: NextRequest) {
  return await gateRequest(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
