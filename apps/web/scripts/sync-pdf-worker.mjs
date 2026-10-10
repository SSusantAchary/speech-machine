import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const source = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs", {
  paths: [appRoot],
});
const destination = path.resolve(appRoot, "public", "pdf.worker.min.mjs");

await mkdir(path.dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log(`Synced pdf worker to ${destination}`);
