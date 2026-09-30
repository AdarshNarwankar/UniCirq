import { NextResponse, type NextRequest } from 'next/server';
// Authentication and authorization are enforced at the data access layer and API.
export function proxy(request:NextRequest){const response=NextResponse.next({request});response.headers.set('Cache-Control','private, no-store');return response}
export const config={matcher:['/student/:path*','/business/:path*','/admin/:path*','/api/:path*']};
