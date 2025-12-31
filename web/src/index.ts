import 'dotenv/config';
import { createServer } from './server';
import { env } from './config/env';
import { initDatabase } from './db/client';
import { startCleanupJob } from './servers/servers.service';

async function main() {
  try {
    // Initialize database
    await initDatabase();
    
    // Create Fastify server
    const server = await createServer();
    
    // Register routes
    const { default: authRoutes } = await import('./auth/auth.routes');
    const { default: usersRoutes } = await import('./users/users.routes');
    const { default: serversRoutes } = await import('./servers/servers.routes');
    
    await server.register(authRoutes, { prefix: '/auth' });
    await server.register(usersRoutes, { prefix: '/users' });
    await server.register(serversRoutes, { prefix: '/servers' });
    
    // Start cleanup job for expired servers
    startCleanupJob();
    
    // Start server
    const port = parseInt(env.PORT, 10);
    await server.listen({ port, host: '0.0.0.0' });
    
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();
