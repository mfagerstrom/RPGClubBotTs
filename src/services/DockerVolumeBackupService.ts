import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DockerBackupOptions = {
  reason?: string;
  backupDir?: string;
  volumes?: string[];
};

const DEFAULT_BACKUP_DIR = process.env.DOCKER_BACKUP_DIR ?? "F:\\";
const DEFAULT_BACKUP_IMAGE = process.env.DOCKER_BACKUP_IMAGE ?? "alpine:3.19";
const DEFAULT_BACKUP_ENABLED = process.env.DOCKER_BACKUP_ENABLED !== "false";

let activeBackup: Promise<void> | null = null;

function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function toDockerPath(inputPath: string): string {
  if (process.platform !== "win32") {
    return path.resolve(inputPath);
  }
  const resolved = path.win32.resolve(inputPath);
  const match = /^([A-Za-z]):\\(.*)/.exec(resolved);
  if (!match) {
    return resolved.replace(/\\/g, "/");
  }
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, "/");
  return `${drive}:/${rest}`;
}

function sanitizeVolumeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function listDockerVolumes(): Promise<string[]> {
  const { stdout } = await execFileAsync("docker", ["volume", "ls", "-q"]);
  return stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function backupVolume(
  volume: string,
  backupDir: string,
  backupDirDocker: string,
  imageName: string,
  timestamp: string,
): Promise<void> {
  const safeName = sanitizeVolumeName(volume);
  const archiveName = `${safeName}_${timestamp}.tar.gz`;
  const archivePath = path.join(backupDir, archiveName);
  const dockerArchivePath = `/backup/${archiveName}`;
  await execFileAsync("docker", [
    "run",
    "--rm",
    "-v",
    `${volume}:/volume`,
    "-v",
    `${backupDirDocker}:/backup`,
    imageName,
    "tar",
    "-czf",
    dockerArchivePath,
    "-C",
    "/volume",
    ".",
  ]);
  console.info(`Docker volume backup created: ${archivePath}`);
}

async function runBackup(options: DockerBackupOptions): Promise<void> {
  if (!DEFAULT_BACKUP_ENABLED) {
    console.info("Docker volume backups are disabled by DOCKER_BACKUP_ENABLED.");
    return;
  }

  const reason = options.reason ?? "manual";
  const backupDir = options.backupDir ?? DEFAULT_BACKUP_DIR;
  const imageName = DEFAULT_BACKUP_IMAGE;
  await fs.mkdir(backupDir, { recursive: true });

  const includeVolumes = options.volumes?.length
    ? options.volumes
    : parseCsvList(process.env.DOCKER_BACKUP_VOLUMES);
  const excludeVolumes = new Set(parseCsvList(process.env.DOCKER_BACKUP_EXCLUDE));

  const volumes = includeVolumes.length
    ? includeVolumes
    : await listDockerVolumes();

  const filtered = volumes
    .filter((volume) => !excludeVolumes.has(volume))
    .sort((a, b) => a.localeCompare(b));

  if (!filtered.length) {
    console.info("No Docker volumes found to back up.");
    return;
  }

  const backupDirDocker = toDockerPath(backupDir);
  const timestamp = formatTimestamp(new Date());

  console.info(
    `Starting Docker volume backup for ${filtered.length} volume(s). Reason: ${reason}.`,
  );

  for (const volume of filtered) {
    await backupVolume(volume, backupDir, backupDirDocker, imageName, timestamp);
  }
}

export async function runDockerVolumeBackup(
  options: DockerBackupOptions = {},
): Promise<void> {
  if (activeBackup) {
    console.info("Docker volume backup already running. Skipping duplicate request.");
    return activeBackup;
  }

  activeBackup = runBackup(options);
  try {
    await activeBackup;
  } finally {
    activeBackup = null;
  }
}
