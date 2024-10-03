import dotenv from 'dotenv';
dotenv.config();

import * as db from 'mssql';

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  server: process.env.DB_HOST,
  port: process.env.DB_PORT,
  options: {
    encrypt: false,
    trustServerCertificate: false,
  },
};

const connectionString = `Server=${config.server},${config.port};Database=${config.database};User Id=${config.user};Password=${config.password};Encrypt=false`;

export const database = new db.ConnectionPool(connectionString);