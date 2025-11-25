CREATE TABLE `chats` (
	`id` uuid PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` uuid PRIMARY KEY NOT NULL,
	`chatId` uuid NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`toolInvocations` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`chatId`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` uuid PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`token` text NOT NULL
);
