import { initOraclePool, getOraclePool } from "../src/db/oracleClient.ts";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

async function run() {
  await initOraclePool();
  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const sql = fs.readFileSync("scripts/sql/20251209_add_is_noisy_to_reminders.sql", "utf8");
    console.log("Executing:", sql);
    await connection.execute(sql);
    console.log("Success.");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await connection.close();
    await pool.close();
  }
}

run();
