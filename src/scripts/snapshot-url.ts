import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

function buildDefaultOutputPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve("snapshots", `snapshot-${timestamp}.png`);
}

async function run(): Promise<void> {
  const [urlArg, outputArg] = process.argv.slice(2);
  // TODO: Add optional CLI args for region capture when needed.
  // Example option 1: `npm run snapshot:url -- <url> --clip 0,0,800,600`
  // Example option 2: `npm run snapshot:url -- <url> <outputPath> 0 0 800 600`
  // Then pass `clip: { x, y, width, height }` to page.screenshot.
  if (!urlArg) {
    console.error("Usage: npm run snapshot:url -- <url> [outputPath]");
    process.exitCode = 1;
    return;
  }

  let url: URL;
  try {
    url = new URL(urlArg);
  } catch {
    console.error("Invalid URL provided.");
    process.exitCode = 1;
    return;
  }

  const outputPath = outputArg ? resolve(outputArg) : buildDefaultOutputPath();
  await mkdir(dirname(outputPath), { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url.toString(), { waitUntil: "networkidle" });
    await page.screenshot({ path: outputPath, fullPage: true });
    console.log(`Snapshot saved to ${outputPath}`);
  } finally {
    await browser.close();
  }
}

void run();
