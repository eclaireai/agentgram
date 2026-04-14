import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    banner: { js: '#!/usr/bin/env node' },
    sourcemap: true,
    splitting: false,
  },
  {
    // No shebang — for programmatic launch (MCP server via launch.json)
    entry: ['src/mcp-server.ts'],
    format: ['esm'],
    sourcemap: false,
    splitting: false,
  },
]);
