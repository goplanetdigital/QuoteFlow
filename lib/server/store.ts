import { databaseOptions } from "./database-config";
import { Pool, PoolClient } from "pg";
import { AppError } from "./config";
import { Snapshot } from "./input";
export type Job = {
  id: string;
  created_at?: Date;
  owner_hash: string;
  snapshot: Snapshot;
  amount: number;
  currency: string;
  state: string;
  session_id: string | null;
  checkout_url: string | null;
  session_expires: string | null;
  excel: Buffer | null;
  printable: Buffer | null;
};
export interface Transaction {
  job: Job;
  save(): Promise<void>;
  hasEvent(id: string): Promise<boolean>;
  recordEvent(id: string): Promise<void>;
}
export interface Store {
  transaction<T>(id: string, fn: (tx: Transaction) => Promise<T>): Promise<T>;
  get(id: string): Promise<Job | undefined>;
}
let pool: Pool | undefined;
export function database() {
  return (pool ??= new Pool(databaseOptions()));
}
export const store: Store = {
  async get(id) {
    return (
      await database().query(
        "SELECT * FROM qf_jobs WHERE id=$1 AND created_at > now() - interval '7 days'",
        [id],
      )
    ).rows[0];
  },
  async transaction(id, fn) {
    const c = await database().connect();
    try {
      await c.query("BEGIN");
      const job = (
        await c.query("SELECT * FROM qf_jobs WHERE id=$1 AND created_at > now() - interval '7 days' FOR UPDATE", [id])
      ).rows[0] as Job | undefined;
      if (!job) throw new AppError(404, "Quotation job not found.");
      const result = await fn({
        job,
        async save() {
          await c.query(
            "UPDATE qf_jobs SET state=$2,session_id=$3,checkout_url=$4,session_expires=$5,excel=$6,printable=$7,updated_at=now() WHERE id=$1",
            [
              id,
              job.state,
              job.session_id,
              job.checkout_url,
              job.session_expires,
              job.excel,
              job.printable,
            ],
          );
        },
        async hasEvent(event) {
          return !!(
            await c.query("SELECT 1 FROM qf_stripe_events WHERE event_id=$1", [
              event,
            ])
          ).rowCount;
        },
        async recordEvent(event) {
          await c.query(
            "INSERT INTO qf_stripe_events(event_id,job_id) VALUES($1,$2)",
            [event, id],
          );
        },
      });
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  },
};
export async function createJob(
  job: Job,
  uploads: { kind: string; filename: string; content: Buffer }[],
) {
  const c: PoolClient = await database().connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO qf_jobs(id,owner_hash,snapshot,amount,currency) VALUES($1,$2,$3,$4,$5)",
      [
        job.id,
        job.owner_hash,
        JSON.stringify(job.snapshot),
        job.amount,
        job.currency,
      ],
    );
    for (const file of uploads)
      await c.query(
        "INSERT INTO qf_uploads(job_id,kind,filename,content) VALUES($1,$2,$3,$4)",
        [job.id, file.kind, file.filename, file.content],
      );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
