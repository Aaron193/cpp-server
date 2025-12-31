CREATE TABLE IF NOT EXISTS "changelog_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"tag" text NOT NULL,
	"changes" text[] NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_name" text,
	"score" bigint DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"play_time_seconds" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changelog_entries_published_at_idx" ON "changelog_entries" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_stats_score_idx" ON "player_stats" USING btree ("score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_stats_user_id_idx" ON "player_stats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_stats_last_played_at_idx" ON "player_stats" USING btree ("last_played_at");