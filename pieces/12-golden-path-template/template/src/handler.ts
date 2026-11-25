import { greet } from './greeting.js';

export interface HttpResult {
  status: number;
  body: string;
}

/** Pure request handler: no sockets, so tests call it directly. */
export function handle(method: string, url: string): HttpResult {
  if (method !== 'GET') return { status: 405, body: 'method not allowed' };
  const { pathname, searchParams } = new URL(url, 'http://localhost');
  if (pathname === '/healthz') return { status: 200, body: 'ok' };
  if (pathname === '/hello') return { status: 200, body: greet(searchParams.get('name')) };
  return { status: 404, body: 'not found' };
}
