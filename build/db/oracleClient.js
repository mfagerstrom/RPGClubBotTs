import oracledb from "oracledb";
let pool = null;
export async function initOraclePool() {
    if (!pool) {
        pool = await oracledb.createPool({
            user: process.env.ORACLE_USER,
            password: process.env.ORACLE_PASSWORD,
            connectString: process.env.ORACLE_CONNECT_STRING ?? "localhost:1521/FREEPDB1",
        });
    }
}
export function getOraclePool() {
    if (!pool)
        throw new Error("Oracle pool not initialized");
    return pool;
}
