import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const webRoot = path.join(repoRoot, "apps", "web");
const nextRoot = path.join(webRoot, ".next");
const standaloneRoot = path.join(nextRoot, "standalone");
const staticRoot = path.join(nextRoot, "static");
const publicRoot = path.join(webRoot, "public");
const manifestPath = path.join(standaloneRoot, "desktop-web.manifest.json");

const ensureExists = (targetPath, message) => {
  if (!existsSync(targetPath)) {
    throw new Error(message);
  }
};

const copyDirectory = async (source, destination) => {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
};

const findServerEntry = async (rootDir) => {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name === "server.js") {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nested = await findServerEntry(entryPath);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
};

const main = async () => {
  ensureExists(
    standaloneRoot,
    "Missing apps/web/.next/standalone. Run `npm --workspace apps/web run build` first."
  );
  ensureExists(staticRoot, "Missing apps/web/.next/static. Run the web build first.");

  const serverEntry = await findServerEntry(standaloneRoot);
  if (!serverEntry) {
    throw new Error("Could not find standalone server.js inside apps/web/.next/standalone.");
  }

  const serverDir = path.dirname(serverEntry);
  await copyDirectory(staticRoot, path.join(serverDir, ".next", "static"));
  if (existsSync(publicRoot)) {
    await copyDirectory(publicRoot, path.join(serverDir, "public"));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    serverEntry: path.relative(standaloneRoot, serverEntry),
    serverDir: path.relative(standaloneRoot, serverDir),
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Prepared desktop web bundle at ${standaloneRoot}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
