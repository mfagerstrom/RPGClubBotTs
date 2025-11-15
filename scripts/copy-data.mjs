import { mkdir, readdir, stat, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC_DIR = join(process.cwd(), "src", "data");
const DEST_DIR = join(process.cwd(), "build", "data");

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await copyFile(from, to);
    } else if (entry.isSymbolicLink()) {
      // Skip symlinks in data dir for safety
    }
  }
}

try {
  await copyDir(SRC_DIR, DEST_DIR);
  console.log(`[copy-data] Copied data directory to ${DEST_DIR}`);
} catch (err) {
  // If src doesn't exist, do nothing (not fatal)
  if (err && err.code === "ENOENT") {
    console.log("[copy-data] No src/data directory to copy.");
  } else {
    console.error("[copy-data] Failed to copy data directory:", err);
    process.exitCode = 1;
  }
}

