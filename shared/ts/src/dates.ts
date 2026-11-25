const DAY_MS = 86_400_000;

/** Whole days from one `YYYY-MM-DD` day to another (UTC). Negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
