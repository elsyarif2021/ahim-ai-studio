import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import path from 'node:path';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: {configPath: './wrangler.test.jsonc'},
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(process.cwd(), 'migrations'))
        }
      }
    }))
  ],
  test: {setupFiles: ['./test/setup.js'], include: ['test/**/*.spec.js']}
});
