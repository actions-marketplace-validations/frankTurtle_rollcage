/** The four roles, in the order the workflow runs them. */
export const ROLES = ['planner', 'implementer', 'tester', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];
