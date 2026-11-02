/** Reads SESSION_SECRET. Never defaulted: a missing secret is a configuration error. */
export function sessionSecret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to a random string of at least 32 characters. See deployment.md.",
    );
  }
  return new TextEncoder().encode(value);
}
