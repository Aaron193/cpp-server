ALTER TABLE "game_servers" ADD COLUMN "build_id" text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE "game_servers" ADD COLUMN "protocol_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "game_servers" ADD COLUMN "map_id" text NOT NULL DEFAULT 'graybox-arena';
--> statement-breakpoint
ALTER TABLE "game_servers" ADD COLUMN "mode" text NOT NULL DEFAULT 'ffa';
--> statement-breakpoint
ALTER TABLE "game_servers" ADD COLUMN "websocket_url" text;
--> statement-breakpoint
UPDATE "game_servers" SET "websocket_url" = 'ws://' || "host" || ':' || "port"::text WHERE "websocket_url" IS NULL;
--> statement-breakpoint
ALTER TABLE "game_servers" ALTER COLUMN "websocket_url" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_protocol_version_valid" CHECK ("protocol_version" BETWEEN 1 AND 65535);
--> statement-breakpoint
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_websocket_url_valid" CHECK ("websocket_url" ~ '^wss?://');
