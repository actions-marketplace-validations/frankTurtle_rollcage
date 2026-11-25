/** Input validation for the scaffold. Each function returns an error message or undefined. */

const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REF = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,127}$/;

export const SHA = /^[0-9a-f]{40}$/;

export function validateName(name: string): string | undefined {
  return NAME.test(name)
    ? undefined
    : `invalid name "${name}": use lowercase letters, digits and hyphens, starting with a letter, up to 64 characters`;
}

export function validateOwner(owner: string): string | undefined {
  return OWNER.test(owner)
    ? undefined
    : `invalid owner "${owner}": use a GitHub user or organization login`;
}

export function validateRef(ref: string): string | undefined {
  return REF.test(ref)
    ? undefined
    : `invalid ref "${ref}": use a tag, branch or commit SHA (letters, digits, . _ - /)`;
}
