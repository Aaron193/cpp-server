import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.e2e.ts',
    timeout: 30_000,
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:5175',
        headless: true,
        viewport: { width: 1280, height: 720 },
        launchOptions: {
            executablePath: '/usr/bin/google-chrome',
            args: ['--enable-unsafe-swiftshader'],
        },
    },
    webServer: [
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5175 --strictPort',
            cwd: import.meta.dirname,
            url: 'http://127.0.0.1:5175',
            reuseExistingServer: false,
            timeout: 30_000,
        },
        {
            command: './server/.build/3d/jolt-validation/server',
            cwd: repositoryRoot,
            url: 'http://127.0.0.1:9002',
            reuseExistingServer: false,
            timeout: 30_000,
            env: {
                ...process.env,
                SERVER_PORT: '9002',
                SERVER_BUILD_ID: 'dev',
                SERVER_MODE: 'ffa',
                SERVER_ID: 'playwright',
                SERVER_WEBSOCKET_URL: 'ws://127.0.0.1:9002',
                JOIN_TICKET_SECRET: 'playwright-join-ticket-secret-32-bytes-minimum',
                JOIN_TICKET_AUDIENCE: 'arena-game-server',
                MAP_PACKAGE_DIR: resolve(repositoryRoot, 'client/public/maps/graybox-arena'),
                WEB_API_URL: '',
                SERVER_SHARED_SECRET: '',
            },
        },
    ],
})
