CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`status` text DEFAULT 'saved' NOT NULL,
	`date_applied` integer,
	`applied_via` text,
	`referrer_name` text,
	`referrer_profile_url` text,
	`referral_notes` text,
	`recruiter_name` text,
	`recruiter_contact` text,
	`follow_up_at` integer,
	`notes` text,
	`statusHistoryJson` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_job_key` ON `applications` (`user_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `applications_user_status_idx` ON `applications` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `applications_follow_up_idx` ON `applications` (`user_id`,`follow_up_at`);--> statement-breakpoint
CREATE TABLE `job_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`search_id` text,
	`band` text NOT NULL,
	`score` integer NOT NULL,
	`matchedSkills` text DEFAULT '[]' NOT NULL,
	`missingSkills` text DEFAULT '[]' NOT NULL,
	`rationale` text,
	`improvementSuggestions` text DEFAULT '[]' NOT NULL,
	`deep_analysis_json` text,
	`deep_analysed_at` integer,
	`model_used` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`scored_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_scores_job_resume_key` ON `job_scores` (`job_id`,`resume_id`);--> statement-breakpoint
CREATE INDEX `job_scores_user_idx` ON `job_scores` (`user_id`);--> statement-breakpoint
CREATE INDEX `job_scores_resume_id_idx` ON `job_scores` (`resume_id`);--> statement-breakpoint
CREATE INDEX `job_scores_search_id_idx` ON `job_scores` (`search_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`company_name` text,
	`location` text,
	`is_remote` integer,
	`employment_type` text,
	`work_mode` text,
	`experience_min_years` real,
	`experience_max_years` real,
	`salary_min` real,
	`salary_max` real,
	`salary_currency` text,
	`salary_period` text,
	`salary_disclosed` integer DEFAULT false NOT NULL,
	`description_full` text NOT NULL,
	`posted_date` integer,
	`applicant_count` integer,
	`source` text NOT NULL,
	`source_url` text,
	`sourceUrls` text DEFAULT '[]' NOT NULL,
	`apply_url` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`repost_count` integer DEFAULT 0 NOT NULL,
	`credibilityFlags` text DEFAULT '[]' NOT NULL,
	`is_bookmarked` integer DEFAULT false NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_user_dedupe_key` ON `jobs` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_user_posted_idx` ON `jobs` (`user_id`,`posted_date`);--> statement-breakpoint
CREATE INDEX `jobs_user_visible_idx` ON `jobs` (`user_id`,`is_hidden`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`full_name` text,
	`email` text,
	`phone` text,
	`total_experience_months` integer,
	`notice_period_days` integer,
	`preferredLocations` text DEFAULT '[]' NOT NULL,
	`open_to_remote` integer DEFAULT false NOT NULL,
	`preferredRoles` text DEFAULT '[]' NOT NULL,
	`current_ctc` real,
	`expected_ctc` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE TABLE `resumes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`storage_path` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`parsed_json` text,
	`parsed_at` integer,
	`parse_error` text,
	`file_size` integer,
	`mime_type` text,
	`local_uri` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE INDEX `resumes_user_id_idx` ON `resumes` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `resumes_one_default_per_user` ON `resumes` (`user_id`) WHERE "resumes"."is_default" = 1 and "resumes"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `search_history_jobs` (
	`search_id` text NOT NULL,
	`job_id` text NOT NULL,
	`user_id` text NOT NULL,
	`prefilter_rank` integer,
	`outside_requested_window` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_history_jobs_pk` ON `search_history_jobs` (`search_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `search_history_jobs_job_id_idx` ON `search_history_jobs` (`job_id`);--> statement-breakpoint
CREATE INDEX `search_history_jobs_user_id_idx` ON `search_history_jobs` (`user_id`);--> statement-breakpoint
CREATE TABLE `searches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resume_id` text,
	`filters_json` text DEFAULT '{}' NOT NULL,
	`window_requested_days` integer,
	`window_used_days` integer,
	`sources` text DEFAULT '[]' NOT NULL,
	`raw_result_count` integer DEFAULT 0 NOT NULL,
	`deduped_count` integer DEFAULT 0 NOT NULL,
	`scored_count` integer DEFAULT 0 NOT NULL,
	`apifyRunIds` text DEFAULT '[]' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE INDEX `searches_user_created_idx` ON `searches` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `searches_resume_id_idx` ON `searches` (`resume_id`);