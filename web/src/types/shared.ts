export interface ErrorResponse {
  error: string;
  code: string;
}

export interface JWTPayload {
  sub: string; // userId
  username: string;
  iat: number;
  exp: number;
}

export interface User {
  id: string;
  username: string;
  email: string | null;
  createdAt: Date;
}

export interface GameServerInfo {
  id: string;
  host: string;
  port: number;
  region: string;
  currentPlayers: number;
  maxPlayers: number;
}
