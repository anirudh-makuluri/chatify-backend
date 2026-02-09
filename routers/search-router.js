const Router = require('express').Router;
const config = require('../config');
const utils = require('../utils');
const vectorEmbedder = require('../helpers/vector-embedder');
const aiHelper = require('../helpers/ai-helper');

const router = new Router();
const MAX_SEARCH_RESULTS = 5;

/**
 * Middleware: verify session cookie and set req.uid
 */
async function requireSession(req, res, next) {
	const sessionCookie = req.cookies?.session || '';
	if (!sessionCookie) {
		return res.status(401).json({ error: 'No session found, please login' });
	}
	try {
		const decoded = await config.firebase.admin.auth().verifySessionCookie(sessionCookie, true);
		req.uid = decoded.uid;
		next();
	} catch (err) {
		res.clearCookie('session');
		return res.status(401).json({ error: 'Session invalid, please login again' });
	}
}

/**
 * GET /api/search?roomId=xxx&query=yyy
 * Semantic search within a room's messages. Returns messages sorted by cosine similarity.
 */
router.get('/search', requireSession, async (req, res) => {
	try {
		const roomId = req.query.roomId;
		const query = (req.query.query || '').trim();
		if (!roomId) {
			return res.status(400).json({ error: 'roomId is required' });
		}
		if (!query) {
			return res.status(400).json({ error: 'query is required' });
		}

		const roomRef = config.firebase.db.collection('rooms').doc(roomId);
		const roomSnap = await roomRef.get();
		if (!roomSnap.exists) {
			return res.status(404).json({ error: 'Room not found' });
		}
		const roomData = roomSnap.data();
		const members = roomData.members || [];
		if (!members.includes(req.uid)) {
			return res.status(403).json({ error: 'Not a member of this room' });
		}

		const chatDocIds = roomData.chat_doc_ids || [];
		const allMessages = [];
		for (const docId of chatDocIds) {
			const chatSnap = await roomRef.collection('chat_history').doc(docId).get();
			if (!chatSnap.exists) continue;
			const chatHistory = chatSnap.data().chat_history || [];
			for (const msg of chatHistory) {
				// Privacy filter: only include searchable messages that are not AI-blind or private bubbles
				const isSearchable = msg.searchable !== false; // Default to true for legacy messages
				const isAIBlind = msg.aiBlind === true;
				const isPrivate = msg.isPrivateBubble === true;
				
				// Skip private/AI-blind messages from search results
				if (isAIBlind || isPrivate || !isSearchable) {
					continue;
				}
				
				if (msg.type === 'text' && Array.isArray(msg.vector_embedding) && msg.vector_embedding.length > 0) {
					allMessages.push({ ...msg, _chatDocId: docId });
				}
			}
		}

		if (allMessages.length === 0) {
			return res.json({ success: true, results: [], message: 'No indexed messages in this room. Send more text messages or run backfill.' });
		}

		const queryVector = await vectorEmbedder.getEmbedding(query);
		if (!queryVector || queryVector.length === 0) {
			return res.status(503).json({ error: 'Embedding service unavailable. Check HG_API_KEY.' });
		}

		const withScores = allMessages.map((msg) => {
			const score = utils.cosineSimilarity(msg.vector_embedding, queryVector);
			const { vector_embedding, _chatDocId, ...rest } = msg;
			return { message: { ...rest, chatDocId: _chatDocId }, score };
		});
		withScores.sort((a, b) => b.score - a.score);
		const results = withScores.slice(0, MAX_SEARCH_RESULTS);

		res.json({ success: true, results });
	} catch (err) {
		console.error('Search error:', err);
		res.status(500).json({ error: 'Search failed' });
	}
});

/**
 * GET /api/summary/:roomId
 * Generate AI summary of conversation in a room, excluding private/AI-blind messages.
 */
router.get('/summary/:roomId', requireSession, async (req, res) => {
	try {
		const { roomId } = req.params;
		if (!roomId) {
			return res.status(400).json({ error: 'roomId is required' });
		}

		const roomRef = config.firebase.db.collection('rooms').doc(roomId);
		const roomSnap = await roomRef.get();
		if (!roomSnap.exists) {
			return res.status(404).json({ error: 'Room not found' });
		}
		const roomData = roomSnap.data();
		const members = roomData.members || [];
		if (!members.includes(req.uid)) {
			return res.status(403).json({ error: 'Not a member of this room' });
		}

		// Collect all non-private messages
		const chatDocIds = roomData.chat_doc_ids || [];
		const allMessages = [];
		for (const docId of chatDocIds) {
			const chatSnap = await roomRef.collection('chat_history').doc(docId).get();
			if (!chatSnap.exists) continue;
			const chatHistory = chatSnap.data().chat_history || [];
			for (const msg of chatHistory) {
				// Skip private/AI-blind messages from summary
				const isAIBlind = msg.aiBlind === true;
				const isPrivate = msg.isPrivateBubble === true;
				
				if (isAIBlind || isPrivate) {
					continue;
				}
				
				if (msg.type === 'text' && msg.chatInfo) {
					allMessages.push(msg);
				}
			}
		}

		if (allMessages.length === 0) {
			return res.json({ success: false, error: 'No messages to summarize' });
		}

		// Sort by time and take recent messages for summary
		allMessages.sort((a, b) => new Date(a.time) - new Date(b.time));
		const recentMessages = allMessages.slice(-50); // Last 50 messages

		const summaryResult = await aiHelper.summarizeConversation(recentMessages);
		
		if (summaryResult.success) {
			res.json({ 
				success: true, 
				summary: summaryResult.summary,
				messageCount: recentMessages.length,
				timestamp: summaryResult.timestamp
			});
		} else {
			res.json({ success: false, error: summaryResult.error || 'Failed to generate summary' });
		}
	} catch (err) {
		console.error('Summary error:', err);
		res.status(500).json({ error: 'Summary generation failed' });
	}
});

module.exports = router;
