import { createServer } from 'node:http';
import { handle } from './handler.js';

const port = Number(process.env['PORT'] ?? 3000);

createServer((req, res) => {
  const { status, body } = handle(req.method ?? 'GET', req.url ?? '/');
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}).listen(port, () => {
  console.log(`listening on ${port}`);
});
