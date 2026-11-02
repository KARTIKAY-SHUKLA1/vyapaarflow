// Loaded before every test file (vitest setupFiles). Any test that has not
// explicitly mocked `fetch` fails loudly instead of reaching a real API.
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`Real network calls are not allowed in tests (attempted: ${new URL(url).host})`);
}) as typeof fetch;
