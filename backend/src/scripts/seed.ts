import yargsParser from "yargs-parser";
import "reflect-metadata";
import axios from "axios";
import { faker } from "@faker-js/faker";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { logger } from "@/utils/winston";

const args = yargsParser(process.argv.slice(2));
const isDocker = args.docker === true;

if (isDocker) {
	process.env.MONGODB_URI = "mongodb://root:secret@127.0.0.1:27017/PhotoAppOOP?authSource=admin&directConnection=true";
	logger.info(`--- Seeder running in [DOCKER] mode ---`);
} else {
	const envPath = path.resolve(__dirname, "../../../.env");
	if (!fs.existsSync(envPath)) {
		console.error(`Error: .env file not found at path: ${envPath}`);
		process.exit(1);
	}
	dotenv.config({ path: envPath });
	logger.info(`--- Seeder running in [DEVELOPMENT] mode ---`);
}

if (!process.env.MONGODB_URI) {
	console.error("FATAL: MONGODB_URI environment variable is not set. Exiting.");
	process.exit(1);
}

import { DatabaseConfig } from "@/config/dbConfig";
import { PublicUserDTO } from "@/services/dto.service";
import { setupContainerCore, registerCQRS, initCQRS } from "../di/container";

const API_BASE_URL = "http://localhost:8000/api";
const NUM_BOTS = 15;
const POSTS_PER_BOT = 5;
const LIKES_PER_BOT = 10;
const FOLLOWS_PER_BOT = 5;
const COMMENTS_PER_BOT = 5;
// IMPORTANT: The script requires at least some sample images in the sample-images folder!

// STATE
interface Bot {
	user: PublicUserDTO;
	token: string;
}
const bots: Bot[] = [];
const postPublicIds: string[] = [];
const sampleImagePaths: string[] = [];

async function bootstrap() {
	logger.info("===========Initializing Seeder===========");

	const dbConfig = new DatabaseConfig();
	await dbConfig.connect();
	logger.info("Database connection established for seeder.");

	setupContainerCore();
	registerCQRS();
	initCQRS();
	logger.info("Dependency container initialized.");

	await seed();
}

// HELPERS
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getRandomElement = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

//  API ACTIONS

async function createBots() {
	logger.info(`Creating ${NUM_BOTS} bots...`);
	for (let i = 0; i < NUM_BOTS; i++) {
		const username = faker.internet
			.username()
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "");
		const email = faker.internet.email();
		const password = "password123";

		try {
			await axios.post(`${API_BASE_URL}/users/register`, {
				username,
				email,
				password,
				confirmPassword: password,
			});
			// Log in the bot to get a token
			const loginRes = await axios.post(`${API_BASE_URL}/users/login`, { email, password });
			bots.push({ user: loginRes.data.user, token: loginRes.data.token });
			logger.info(`   - Created & logged in bot: ${username}`);
		} catch (error: any) {
			console.error(`   - Failed to create bot ${username}:`, error.response?.data || error.message);
		}
		await sleep(50); // Small delay to avoid screwing the server
	}
}

async function botsUploadPosts() {
	logger.info(`\n Each bot will now upload ${POSTS_PER_BOT} posts...`);
	for (const bot of bots) {
		for (let i = 0; i < POSTS_PER_BOT; i++) {
			const imagePath = getRandomElement(sampleImagePaths);
			const imageBuffer = fs.readFileSync(imagePath);
			const form = new FormData();
			const body = faker.lorem.sentence() + ` #${faker.word.noun()}`;

			form.append("image", imageBuffer, path.basename(imagePath));
			form.append("body", body);

			try {
				const { data: postObject } = await axios.post(`${API_BASE_URL}/posts`, form, {
					headers: {
						...form.getHeaders(),
						Authorization: `Bearer ${bot.token}`,
					},
				});
				postPublicIds.push(postObject.publicId);
				logger.info(`   - Bot ${bot.user.username} posted: "${body.substring(0, 30)}..."`);
			} catch (error: any) {
				console.error(`   - Bot ${bot.user.username} failed to post:`, error.response?.data || error.message);
			}
			await sleep(100);
		}
	}
}

async function botsFollowEachOther() {
	logger.info(`\n Bots will now follow ${FOLLOWS_PER_BOT} other bots each...`);
	for (const bot of bots) {
		const api = axios.create({ headers: { Authorization: `Bearer ${bot.token}` } });
		let follows = 0;
		while (follows < FOLLOWS_PER_BOT) {
			const otherBot = getRandomElement(bots);
			if (otherBot.user.publicId === bot.user.publicId) continue; // don't try follwing self

			try {
				await api.post(`${API_BASE_URL}/users/follow/${otherBot.user.publicId}`);
				logger.info(`   - ${bot.user.username} followed ${otherBot.user.username}`);
				follows++;
			} catch {}
		}
		await sleep(50);
	}
}

async function botsLikePosts() {
	logger.info(`\n Each bot will now like ${LIKES_PER_BOT} random posts...`);
	if (postPublicIds.length === 0) {
		logger.info("   - No posts to like. Skipping.");
		return;
	}
	for (const bot of bots) {
		const api = axios.create({ headers: { Authorization: `Bearer ${bot.token}` } });
		for (let i = 0; i < LIKES_PER_BOT; i++) {
			const postId = getRandomElement(postPublicIds);
			try {
				await api.post(`${API_BASE_URL}/users/like/post/${postId}`);
			} catch {}
		}
		logger.info(`   - ${bot.user.username} liked ${LIKES_PER_BOT} posts.`);
		await sleep(50);
	}
}

async function botsCommentOnPosts() {
	logger.info(`\n Each bot will now comment on ${COMMENTS_PER_BOT} random posts...`);
	if (postPublicIds.length === 0) {
		logger.info("   - No posts to comment on. Skipping.");
		return;
	}
	for (const bot of bots) {
		const api = axios.create({ headers: { Authorization: `Bearer ${bot.token}` } });
		for (let i = 0; i < COMMENTS_PER_BOT; i++) {
			const postId = getRandomElement(postPublicIds);
			try {
				await api.post(`${API_BASE_URL}/posts/${postId}/comments`, {
					content: faker.hacker.phrase(),
				});
			} catch {}
		}
		logger.info(`   - ${bot.user.username} commented on ${COMMENTS_PER_BOT} posts.`);
		await sleep(50);
	}
}

// MAIN ORCHESTRATION
async function seed() {
	logger.info("--- Starting Database Seeding ---");

	// Load sample images or create a placeholder if none exist so seeding can run
	const imagesDir = path.join(__dirname, "sample-images");
	if (!fs.existsSync(imagesDir)) {
		fs.mkdirSync(imagesDir, { recursive: true });
	}

	const files = fs.readdirSync(imagesDir).filter((f) => !f.startsWith("."));
	// if no images found - create a small 1x1 PNG placeholder
	if (files.length === 0) {
		const placeholderPath = path.join(imagesDir, "placeholder.png");
		// a minimal 1x1 transparent PNG
		const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
		fs.writeFileSync(placeholderPath, Buffer.from(base64Png, "base64"));
		files.push("placeholder.png");
	}

	files.forEach((file) => {
		sampleImagePaths.push(path.join(imagesDir, file));
	});

	await createBots();
	await botsUploadPosts();
	await botsLikePosts();
	await botsFollowEachOther();
	await botsCommentOnPosts();

	logger.info("\n Seeding Complete!");
	logger.info(`- Created ${bots.length} users.`);
	logger.info(`- Created ${postPublicIds.length} posts.`);
	logger.info("- Bots have followed each other and interacted with posts.");
	logger.info("\nFeeds should now be populated with data!");
}

// RUN THE SCRIPT
// initialize the DI container and CQRS so any local services are ready
// even though the script talks to the gateway
bootstrap()
	.then(() => {
		logger.info("Seeder finished successfully.");
		process.exit(0);
	})
	.catch((err) => {
		console.error("\n Seeding Script Failed");
		console.error(err);
		process.exit(1);
	});
