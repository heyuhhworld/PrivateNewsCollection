CREATE TABLE `bookmarks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`articleId` int NOT NULL,
	`userId` int,
	`sessionId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bookmarks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crawl_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`source` enum('Preqin','Pitchbook') NOT NULL,
	`cronExpr` varchar(64) NOT NULL,
	`rangeInDays` int NOT NULL DEFAULT 7,
	`isEnabled` boolean NOT NULL DEFAULT true,
	`lastRunAt` timestamp,
	`lastRunStatus` enum('success','failed','running'),
	`lastRunMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crawl_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crawl_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`status` enum('success','failed','running') NOT NULL,
	`articlesFound` int DEFAULT 0,
	`articlesAdded` int DEFAULT 0,
	`message` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	CONSTRAINT `crawl_logs_id` PRIMARY KEY(`id`)
);
