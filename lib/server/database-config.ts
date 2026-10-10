import { PoolConfig } from "pg";
import { AppError } from "./config";

export function databaseOptions(env: Readonly<Record<string, string | undefined>> = process.env): PoolConfig {
  try {
    if (!env.DATABASE_URL) throw new Error();
    const url = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    const local = env.VERCEL !== "1" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!local) {
      if (env.VERCEL_ENV === "production" || env.QF_DATABASE_SCOPE !== "preview" || !env.QF_DATABASE_NAME || decodeURIComponent(url.pathname.slice(1)) !== env.QF_DATABASE_NAME) throw new Error();
      // pg connection-string SSL flags otherwise override explicit TLS options.
      if (["disable", "allow", "prefer", "no-verify"].includes(url.searchParams.get("sslmode") ?? "")) throw new Error();
      for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
    }
    return { connectionString: url.toString(), ...(!local ? { ssl: { rejectUnauthorized: true } } : {}), max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 15000 };
  } catch { throw new AppError(503, "Dedicated Preview quotation storage is not configured securely."); }
}
