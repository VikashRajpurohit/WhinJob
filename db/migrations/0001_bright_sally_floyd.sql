ALTER TABLE `job_scores` ADD `score_components_json` text;--> statement-breakpoint
ALTER TABLE `job_scores` ADD `apply_kit_json` text;--> statement-breakpoint
ALTER TABLE `job_scores` ADD `apply_kit_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `careers_url` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `is_early_applicant` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `is_consultant_posting` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `company_rating` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `keyword_match_percent` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `score_deferred` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `resumes` ADD `expansion_key` text;--> statement-breakpoint
ALTER TABLE `resumes` ADD `expansion_json` text;--> statement-breakpoint
ALTER TABLE `searches` ADD `recall_audit_json` text;