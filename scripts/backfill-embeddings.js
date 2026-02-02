#!/usr/bin/env node
/**
 * Backfill script: add vector embeddings to all existing chat messages.
 * Run from chatify-backend: node scripts/backfill-embeddings.js
 *
 * Requires: .env with Firebase credentials and HG_API_KEY (Hugging Face).
 */

require('dotenv').config();
const admin = require('firebase-admin');
const config = require('../config');
const vectorEmbedder = require('../helpers/vector-embedder');

const BATCH_DELAY_MS = 100; // Small delay between embedding calls to avoid rate limits

async function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function main() {
	if (!process.env.HG_API_KEY) {
		console.error('Missing HG_API_KEY in .env. Cannot run backfill.');
		process.exit(1);
	}

	// Initialize Firebase (same as app.js)
	if (!admin.apps.length) {
		admin.initializeApp({
			credential: admin.credential.cert(config.serviceAccount),
			storageBucket: config.firebase.storageBucketName,
		});
	}
	const db = admin.firestore();

	console.log('Starting backfill: adding vector embeddings to all existing chat messages...\n');

	let totalRooms = 0;
	let totalDocs = 0;
	let totalUpdated = 0;
	let totalSkipped = 0;
	let totalFailed = 0;

	const roomsSnap = await db.collection('rooms').get();
	totalRooms = roomsSnap.size;

	for (const roomDoc of roomsSnap.docs) {
		const roomId = roomDoc.id;
		const roomData = roomDoc.data();
		const chatDocIds = roomData.chat_doc_ids || [];

		for (const docId of chatDocIds) {
			const docRef = roomDoc.ref.collection('chat_history').doc(docId);
			const docSnap = await docRef.get();
			if (!docSnap.exists) continue;

			totalDocs++;
			const chatHistory = docSnap.data().chat_history || [];
			let changed = false;

			for (let i = 0; i < chatHistory.length; i++) {
				const msg = chatHistory[i];
				if (msg.type !== 'text' || msg.userUid === 'ai-assistant') continue;
				if (Array.isArray(msg.vector_embedding) && msg.vector_embedding.length > 0) {
					totalSkipped++;
					continue;
				}
				const text = typeof msg.chatInfo === 'string' ? msg.chatInfo.trim() : '';
				if (!text) continue;

				const embedding = await vectorEmbedder.getEmbedding(text);
				await sleep(BATCH_DELAY_MS);

				if (embedding && embedding.length > 0) {
					chatHistory[i] = { ...msg, vector_embedding: embedding };
					changed = true;
					totalUpdated++;
					process.stdout.write(`\r  Room ${roomId.slice(0, 12)}… | Updated: ${totalUpdated} | Skipped: ${totalSkipped} | Failed: ${totalFailed}   `);
				} else {
					totalFailed++;
				}
			}

			if (changed) {
				await docRef.update({ chat_history: chatHistory });
			}
		}
	}

	console.log('\n\nBackfill complete.');
	console.log(`  Rooms processed: ${totalRooms}`);
	console.log(`  Chat docs scanned: ${totalDocs}`);
	console.log(`  Messages updated (embedding added): ${totalUpdated}`);
	console.log(`  Messages skipped (already had embedding): ${totalSkipped}`);
	console.log(`  Messages failed (no embedding returned): ${totalFailed}`);
	process.exit(0);
}

main().catch((err) => {
	console.error('Backfill failed:', err);
	process.exit(1);
});
