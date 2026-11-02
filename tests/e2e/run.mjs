// End-to-end smoke test runner.
//
//   npm run build && npm run e2e
//
// Uses its own database (data/e2e.db, reset and seeded every run), starts the
// production server on port 3100 with demo OTP on and AI set to the rule-based
// matcher, runs every suite in a real headless browser, and exits non-zero if any
// check fails. Set E2E_BASE_URL to test an already running server instead
// (that server's data will be modified).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { launch } from "./lib.mjs";
import desk from "./desk.mjs";
import retailer from "./retailer.mjs";
import security from "./security.mjs";

const external = Boolean(process.env.E2E_BASE_URL);
const PORT = 3100;
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "file:./data/e2e.db",
  DATABASE_AUTH_TOKEN: "",
  SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(32).toString("base64url"),
  DEMO_MODE: "true",
  AI_PROVIDER: "none", // deterministic: the UI must label the rule-based fallback
  ANTHROPIC_API_KEY: "",
};

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: "inherit", shell: process.platform === "win32" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
  });
}

async function waitForServer(url, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server did not start at ${url}`);
}

let server;
async function main() {
  if (!external) {
    if (!existsSync(".next/BUILD_ID")) throw new Error("No production build found. Run `npm run build` first.");
    console.log("Resetting e2e database (data/e2e.db)…");
    await run("npx", ["tsx", "scripts/reset.ts"]);
    console.log(`Starting production server on :${PORT}…`);
    server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore", shell: process.platform === "win32" });
    await waitForServer(`http://localhost:${PORT}/login`);
  }

  const browser = await launch();
  const failures = [];
  try {
    const only = process.env.E2E_ONLY?.split(",");
    for (const [name, suite] of [["retailer", retailer], ["desk", desk], ["security", security]]) {
      if (only && !only.includes(name)) continue;
      console.log(`\n■ ${name}`);
      const checks = await suite(browser);
      failures.push(...checks.failed.map((f) => `${name}: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`));
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll end-to-end checks passed.");
  }
}

function stopServer() {
  if (!server?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(stopServer);
