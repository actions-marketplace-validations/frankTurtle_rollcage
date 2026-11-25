import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIECE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_POLICY_DIR = join(PIECE_DIR, 'policies');
/** Recorded model responses used when --live is not set. */
export const LLM_FIXTURE_DIR = join(PIECE_DIR, 'examples', 'llm-fixtures');
