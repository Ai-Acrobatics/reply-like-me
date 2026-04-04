import "dotenv/config";
import { runPipeline, rebuildAllProfiles } from "./pipeline/processor.js";
import { healthCheck } from "./ollama/client.js";

const COMMANDS = {
  run: "Process unclassified messages and update profiles",
  "rebuild-profiles": "Rebuild all communication profiles from existing classifications",
  health: "Check Ollama connection and model availability",
} as const;

async function main() {
  const command = process.argv[2] ?? "run";

  if (command === "help" || command === "--help") {
    console.log("Reply Like Me — Message Processing Pipeline\n");
    console.log("Usage: npx tsx src/index.ts [command]\n");
    console.log("Commands:");
    for (const [cmd, desc] of Object.entries(COMMANDS)) {
      console.log(`  ${cmd.padEnd(20)} ${desc}`);
    }
    process.exit(0);
  }

  switch (command) {
    case "run": {
      const result = await runPipeline();
      process.exit(result.errors.length > 0 ? 1 : 0);
    }

    case "rebuild-profiles": {
      const result = await rebuildAllProfiles();
      process.exit(result.errors.length > 0 ? 1 : 0);
    }

    case "health": {
      const health = await healthCheck();
      console.log(
        health.ok
          ? `✓ Ollama OK — model: ${health.model}`
          : `✗ Ollama ERROR: ${health.error}`
      );
      process.exit(health.ok ? 0 : 1);
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error(`Run with --help for usage`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
