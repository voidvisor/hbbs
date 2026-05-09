import mariadb from "mariadb";

declare global {
  // eslint-disable-next-line no-var
  var dbPool: mariadb.Pool | undefined;
}

const pool =
  globalThis.dbPool ??
  mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 3,
    idleTimeout: 30,
  });

// In development, preserve the pool across HMR reloads
if (process.env.NODE_ENV !== "production") {
  globalThis.dbPool = pool;
}

// Register the shutdown handler exactly once on the real process object
process.once("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});

export default pool;

