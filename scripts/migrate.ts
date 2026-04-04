/**
 * Run SQL migrations against Supabase.
 * Reads .sql files from scripts/sql/ in order and executes them.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function runMigrations() {
  const sqlDir = join(import.meta.dirname ?? ".", "sql");
  const files = readdirSync(sqlDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration files\n`);

  for (const file of files) {
    console.log(`Running: ${file}`);
    const sql = readFileSync(join(sqlDir, file), "utf-8");

    const { error } = await supabase.rpc("exec_sql", { sql_text: sql }).single();

    if (error) {
      // Try direct execution via REST API if rpc doesn't exist
      console.log(`  RPC not available, trying direct SQL...`);
      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`,
        {
          method: "POST",
          headers: {
            apikey: process.env.SUPABASE_SERVICE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sql_text: sql }),
        }
      );

      if (!response.ok) {
        console.error(`  FAILED: ${error.message}`);
        console.log(`  Manual migration required. Run this SQL in Supabase SQL editor:`);
        console.log(`  File: scripts/sql/${file}\n`);
        continue;
      }
    }

    console.log(`  OK`);
  }

  console.log("\nMigrations complete.");
}

runMigrations().catch(console.error);
