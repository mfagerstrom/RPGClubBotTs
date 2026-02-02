import { runDockerVolumeBackup } from "../src/services/DockerVolumeBackupService.js";

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length ? parts : undefined;
}

const args = process.argv.slice(2);
const reason = getArgValue(args, "--reason") ?? "scheduled";
const backupDir = getArgValue(args, "--backup-dir");
const volumes = parseCsv(getArgValue(args, "--volumes"));

runDockerVolumeBackup({ reason, backupDir, volumes }).catch((error) => {
  console.error("Docker volume backup failed.", error);
  process.exitCode = 1;
});
