import oracledb from "oracledb";

let pool: oracledb.Pool | null = null;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function initOraclePool() {
  if (!pool) {
    pool = await oracledb.createPool({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING ?? "localhost:1521/FREEPDB1",
      poolMin: readIntEnv("ORACLE_POOL_MIN", 2),
      poolMax: readIntEnv("ORACLE_POOL_MAX", 16),
      poolIncrement: readIntEnv("ORACLE_POOL_INCREMENT", 1),
      queueTimeout: readIntEnv("ORACLE_POOL_QUEUE_TIMEOUT_MS", 5_000),
      poolTimeout: readIntEnv("ORACLE_POOL_IDLE_TIMEOUT_SECONDS", 60),
      stmtCacheSize: readIntEnv("ORACLE_STMT_CACHE_SIZE", 60),
    });
  }
}

export function getOraclePool(): oracledb.Pool {
  if (!pool) throw new Error("Oracle pool not initialized");
  return pool;
}
