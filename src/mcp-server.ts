/**
 * MCP server entry point — no shebang, for programmatic launch.
 * Used by launch.json / preview_start so Node ESM doesn't choke on #!
 */
import { createProgram } from './cli.js';

process.argv = [process.argv[0]!, process.argv[1]!, 'mcp'];
createProgram().parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
