CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "athletes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"tournament_id" uuid,
	"name" text NOT NULL,
	"chest_number" text,
	"belt" text,
	"age" text,
	"sex" text,
	"day" text,
	"dojo" text,
	"school" text,
	"school_code" text,
	"sports_id" text,
	"weight" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"name" text NOT NULL,
	"age_bracket" text,
	"weight_class" text,
	"athletes_count" integer DEFAULT 0 NOT NULL,
	"expected_matches" integer DEFAULT 0 NOT NULL,
	"has_full_roster" boolean DEFAULT false NOT NULL,
	"belt" text,
	"age_min" integer,
	"age_max" integer,
	"sex" text,
	"day" text,
	"doc_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ring_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"queue_order" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"matches_completed" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_assignments_ring_id_queue_order_unique" UNIQUE("ring_id","queue_order"),
	CONSTRAINT "category_assignments_category_id_unique" UNIQUE("category_id")
);
--> statement-breakpoint
CREATE TABLE "category_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"registration_id" uuid,
	"athlete_id" uuid NOT NULL,
	"seed" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_entries_category_id_athlete_id_unique" UNIQUE("category_id","athlete_id")
);
--> statement-breakpoint
CREATE TABLE "draw_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draw_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draw_versions_draw_id_version_unique" UNIQUE("draw_id","version")
);
--> statement-breakpoint
CREATE TABLE "draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"format" text DEFAULT 'SINGLE_ELIMINATION' NOT NULL,
	"ruleset_id" text DEFAULT 'WKF_KUMITE_2026' NOT NULL,
	"tournament_size" integer NOT NULL,
	"bye_count" integer DEFAULT 0 NOT NULL,
	"checksum" text NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draws_category_id_unique" UNIQUE("category_id")
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"ring_id" uuid NOT NULL,
	"category_id" uuid,
	"moderator_session_id" uuid,
	"action" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text,
	"device_id" text,
	"command_id" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_events_match_id_seq_unique" UNIQUE("match_id","seq")
);
--> statement-breakpoint
CREATE TABLE "match_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"position" integer NOT NULL,
	"slot_type" text NOT NULL,
	"athlete_id" uuid,
	"source_match_id" text,
	CONSTRAINT "match_slots_match_id_position_unique" UNIQUE("match_id","position")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"match_no" integer NOT NULL,
	"round_no" integer NOT NULL,
	"round_name" text NOT NULL,
	"bracket_type" text DEFAULT 'MAIN' NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"winner_id" uuid,
	"aka_score" integer DEFAULT 0 NOT NULL,
	"ao_score" integer DEFAULT 0 NOT NULL,
	"aka_penalties" integer DEFAULT 0 NOT NULL,
	"ao_penalties" integer DEFAULT 0 NOT NULL,
	"senshu" text,
	"winner_side" text,
	"decision_method" text,
	CONSTRAINT "matches_category_id_match_no_unique" UNIQUE("category_id","match_no")
);
--> statement-breakpoint
CREATE TABLE "moderator_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ring_id" uuid NOT NULL,
	"access_code_used" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"session_token" uuid,
	"device_info" jsonb DEFAULT '{}'::jsonb,
	"moderator_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "moderator_requests_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "rings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ring_order" integer NOT NULL,
	"access_code" text NOT NULL,
	"timer_status" text DEFAULT 'idle' NOT NULL,
	"timer_started_at" timestamp with time zone,
	"timer_paused_at" timestamp with time zone,
	"timer_accumulated_seconds" integer DEFAULT 0 NOT NULL,
	"current_match_id" text,
	"match_duration_seconds" integer DEFAULT 180 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rings_tournament_id_name_unique" UNIQUE("tournament_id","name")
);
--> statement-breakpoint
CREATE TABLE "tournament_category_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"category_name" text NOT NULL,
	"event_type" text NOT NULL,
	"gender" text NOT NULL,
	"min_age" integer,
	"max_age" integer,
	"min_weight" numeric(5, 2),
	"max_weight" numeric(5, 2),
	"rules" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"weight" numeric(5, 2),
	"kata" boolean DEFAULT false NOT NULL,
	"kumite" boolean DEFAULT false NOT NULL,
	"team_kata" boolean DEFAULT false NOT NULL,
	"team_kumite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_registrations_tournament_id_athlete_id_unique" UNIQUE("tournament_id","athlete_id")
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_date" date,
	"venue" text,
	"city" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"organiser_code" text,
	"stager_codes" jsonb DEFAULT '[]'::jsonb,
	"show_public_draws" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD CONSTRAINT "category_assignments_ring_id_rings_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."rings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD CONSTRAINT "category_assignments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_entries" ADD CONSTRAINT "category_entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_entries" ADD CONSTRAINT "category_entries_registration_id_tournament_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."tournament_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_entries" ADD CONSTRAINT "category_entries_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_versions" ADD CONSTRAINT "draw_versions_draw_id_draws_id_fk" FOREIGN KEY ("draw_id") REFERENCES "public"."draws"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draws_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_ring_id_rings_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."rings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_slots" ADD CONSTRAINT "match_slots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_slots" ADD CONSTRAINT "match_slots_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_slots" ADD CONSTRAINT "match_slots_source_match_id_matches_id_fk" FOREIGN KEY ("source_match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_id_athletes_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."athletes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_requests" ADD CONSTRAINT "moderator_requests_ring_id_rings_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."rings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rings" ADD CONSTRAINT "rings_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_category_definitions" ADD CONSTRAINT "tournament_category_definitions_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;