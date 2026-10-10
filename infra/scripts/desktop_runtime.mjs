import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiScript = path.join(__dirname, "desktop_api.py");
const webScript = path.join(__dirname, "desktop_web.mjs");
const apiPort = process.env.DESKTOP_API_PORT || "18000";
const webPort = process.env.DESKTOP_WEB_PORT || "13000";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForHttp = async (url, timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the timeout.
    }
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const forwardSignal = (child, signal) => {
  if (child.exitCode === null) {
    child.kill(signal);
  }
};

const main = async () => {
  const apiProcess = spawn(process.env.DESKTOP_PYTHON || "python3", [apiScript], {
    stdio: "inherit",
    env: process.env,
  });

  process.on("SIGINT", () => forwardSignal(apiProcess, "SIGINT"));
  process.on("SIGTERM", () => forwardSignal(apiProcess, "SIGTERM"));

  await waitForHttp(`http://127.0.0.1:${apiPort}/docs`, 60000);

  const webProcess = spawn(process.execPath, [webScript], {
    stdio: "inherit",
    env: process.env,
  });

  process.on("SIGINT", () => forwardSignal(webProcess, "SIGINT"));
  process.on("SIGTERM", () => forwardSignal(webProcess, "SIGTERM"));

  console.log(`Desktop runtime ready: web=http://127.0.0.1:${webPort} api=http://127.0.0.1:${apiPort}`);

  apiProcess.on("exit", (code) => {
    forwardSignal(webProcess, "SIGTERM");
    process.exitCode = code ?? 0;
  });
  webProcess.on("exit", (code) => {
    forwardSignal(apiProcess, "SIGTERM");
    process.exitCode = code ?? 0;
  });
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
