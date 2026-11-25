/** The CLI arguments the demo uses. Shared with the script that records the model responses. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const piece = join(here, '..');
export const fixtures = join(piece, 'fixtures');
export const apps = join(here, 'apps');

export const AS_OF = '2026-11-25';

export const APP_ARGS = [
  ...['--app', `shop-api:${join(fixtures, 'grype-node-app.json')}:${join(apps, 'node-app')}`],
  ...[
    '--app',
    `report-worker:${join(fixtures, 'grype-python-app.json')}:${join(apps, 'python-app')}`,
  ],
  ...['--sbom', join(fixtures, 'node-app.cdx.json')],
  ...['--sbom', join(fixtures, 'python-app.cdx.json')],
  ...['--history', join(fixtures, 'history.json')],
  ...['--waivers', join(fixtures, 'waivers.json')],
  ...['--as-of', AS_OF],
];
