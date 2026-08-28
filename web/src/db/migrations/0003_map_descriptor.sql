ALTER TABLE "game_servers" ADD COLUMN "map_format_version" integer NOT NULL DEFAULT 2;
ALTER TABLE "game_servers" ADD COLUMN "map_content_hash" text NOT NULL DEFAULT '';
