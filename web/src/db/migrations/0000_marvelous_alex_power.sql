CREATE TABLE IF NOT EXISTS "game_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"region" text NOT NULL,
	"max_players" integer NOT NULL,
	"current_players" integer DEFAULT 0 NOT NULL,
	"last_heartbeat" timestamp DEFAULT now() NOT NULL,
	"is_online" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_servers_region_idx" ON "game_servers" USING btree ("region");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_servers_is_online_idx" ON "game_servers" USING btree ("is_online");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_servers_last_heartbeat_idx" ON "game_servers" USING btree ("last_heartbeat");