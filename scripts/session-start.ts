import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, "..");
  const agentsPath = path.join(root, "AGENTS.md");
  try {
    const agents = fs.readFileSync(agentsPath, "utf8");
    console.log("--- AGENTS.md ---\n");
    console.log(agents);
  } catch (err: any) {
    console.error("Failed to read AGENTS.md:", err?.message ?? err);
  }

  try {
    const gitLog = execSync(
      'git log --pretty=format:"%h %ad %s" --date=short -n 50',
      { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
    ).toString();

    const commitHistoryPath = path.join(root, "COMMIT-HISTORY.md");
    const header = `# Commit snapshot (${new Date().toISOString().slice(0, 10)})\n\n`;
    const content = `${header}${gitLog}\n`;

    let existing = "";
    if (fs.existsSync(commitHistoryPath)) {
      try {
        existing = fs.readFileSync(commitHistoryPath, { encoding: "utf8" });
      } catch {
        // ignore read errors and continue with empty existing
      }
      // If already wrote today's header, skip updating
      if (existing.startsWith(header)) {
        console.log("COMMIT-HISTORY.md already up to date for today.");
        return;
      }
    }

    const newContent = `${content}\n${existing}`;
    fs.writeFileSync(commitHistoryPath, newContent, { encoding: "utf8" });
    console.log(`Prepended COMMIT-HISTORY.md (${commitHistoryPath})`);
  } catch (err: any) {
    console.error("Failed to update COMMIT-HISTORY.md:", err?.message ?? err);
  }
}

void main();
