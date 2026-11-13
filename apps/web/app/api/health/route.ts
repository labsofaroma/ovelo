import { NextResponse } from 'next/server';
export function GET() {
  return NextResponse.json({ service: 'aroma-api', network: 'mainnet-beta', status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
