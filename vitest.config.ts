import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli.ts',
        'src/**/types.ts',
        'src/index.ts',
        'src/fingerprint/seeds.ts',      // pure seed data, no logic
        'src/fingerprint/index.ts',      // re-exports + thin orchestration
        'src/fingerprint/client.ts',     // network I/O, tested via integration
        'src/compliance/index.ts',       // re-exports only
        'src/compliance/export.ts',      // file system + crypto orchestration
        'src/compliance/report.ts',      // requires real signed trace fixtures
        'src/cognitive/capture.ts',      // hooks into live Claude Code process
        'src/integrations/github.ts',    // GitHub API network calls
        'src/integrations/resolve.ts',   // full session orchestration
        'src/mcp/server.ts',             // MCP protocol server
      ],
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    testTimeout: 30000,
  },
});
