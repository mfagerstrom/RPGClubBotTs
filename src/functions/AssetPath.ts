import { fileURLToPath } from "url";
import { join, resolve } from "node:path";

const ASSETS_ROOT = resolve(fileURLToPath(new URL("../../src/assets", import.meta.url)));

export function resolveAssetPath(...segments: string[]): string {
  return join(ASSETS_ROOT, ...segments);
}
