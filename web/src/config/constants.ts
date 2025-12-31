export const CONSTANTS = {
  // Password requirements
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  
  // Username requirements
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 20,
  
  // Server heartbeat
  HEARTBEAT_TIMEOUT_SECONDS: 10,
  
  // Cleanup job interval
  CLEANUP_INTERVAL_MS: 5000, // 5 seconds
  
  // Cookie names
  COOKIE_ACCESS_TOKEN: 'access_token',
  
  // Rate limiting
  RATE_LIMIT_MAX: 10,
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
} as const;
