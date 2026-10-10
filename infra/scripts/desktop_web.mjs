import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const standaloneRoot = path.join(repoRoot, "apps", "web", ".next", "standalone");
const manifestPath = path.join(standaloneRoot, "desktop-web.manifest.json");
const apiPort = process.env.DESKTOP_API_PORT || "18000";
const webPort = process.env.DESKTOP_WEB_PORT || "13000";
const webHost = process.env.DESKTOP_WEB_HOST || "127.0.0.1";

const main = async () => {
  if (!existsSync(manifestPath)) {
    throw new Error(
      "Missing desktop web manifest. Run `npm run desktop:build:web` before starting the desktop web runtime."
    );
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const serverDir = path.join(standaloneRoot, manifest.serverDir);
  const serverEntry = path.join(standaloneRoot, manifest.serverEntry);

  const child = spawn(process.execPath, [serverEntry], {
    cwd: serverDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: webHost,
      PORT: webPort,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || `http://127.0.0.1:${apiPort}`,
      NEXT_PUBLIC_LOCAL_ONLY_MODE: process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE || "true",
    },
  });

  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
