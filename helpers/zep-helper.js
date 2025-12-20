const { ZepClient } = require('@getzep/zep-cloud');
const config = require('../config');

let zepClient = null;
try {
	if (config.zep && config.zep.apiKey) {
		zepClient = new ZepClient({ apiKey: config.zep.apiKey });
		console.log('Zep client initialized with API key');
	} else {
		console.warn('Zep not configured - memory features will be disabled. Set ZEP_API_KEY in .env');
	}
} catch (error) {
	console.error('Failed to initialize Zep client:', error);
	console.warn('Zep memory features will be disabled');
}

module.exports = {
	createUser: async function(userId, userData = {}) {
		if (!zepClient) {
			return { success: false, error: 'Zep client not initialized' };
		}

		try {
			await zepClient.user.add({
				userId: userId,
				firstName: userData.firstName || userData.name || '',
				lastName: userData.lastName || '',
				email: userData.email || ''
			});

			return { success: true, isNew: true };
		} catch (error) {
			if (error.message && error.message.includes('already exists')) {
				return { success: true, isNew: false };
			}
			console.error('Zep createUser error:', error);
			return { success: false, error: error.message };
		}
	},

	createThread: async function(userId, threadId = null, metadata = {}) {
		if (!zepClient) {
			return { success: false, error: 'Zep client not initialized' };
		}

		try {
			await this.createUser(userId);

			const threadIdToUse = threadId || `user-${userId}`;
			
			// First, try to get the thread to see if it already exists
			try {
				const existingThread = await zepClient.thread.get(threadIdToUse);
				// Thread exists, return it without creating a new one
				return { success: true, thread: existingThread, isNew: false };
			} catch (getError) {
				// Thread doesn't exist, create it
				try {
					const thread = await zepClient.thread.create({
						threadId: threadIdToUse,
						userId: userId,
						metadata: {
							...metadata,
							created_at: new Date().toISOString()
						}
					});

					return { success: true, thread, isNew: true };
				} catch (createError) {
					// In case of race condition where thread was created between get and create
					if (createError.message && (createError.message.includes('already exists') || createError.message.includes('duplicate'))) {
						// Try to get it again
						const existingThread = await zepClient.thread.get(threadIdToUse);
						return { success: true, thread: existingThread, isNew: false };
					}
					throw createError;
				}
			}
		} catch (error) {
			console.error('Zep createThread error:', error);
			return { success: false, error: error.message };
		}
	},

	addMessages: async function(threadId, messages, returnContext = false) {
		if (!zepClient) {
			return { success: false, error: 'Zep client not initialized' };
		}

		try {
			const response = await zepClient.thread.addMessages(threadId, {
				messages: messages,
				returnContext: returnContext
			});

			return { 
				success: true, 
				result: response,
				context: returnContext ? response.context : null
			};
		} catch (error) {
			console.error('Zep addMessages error:', error);
			return { success: false, error: error.message };
		}
	},

	addMessage: async function(threadId, role, content, metadata = {}, name = null) {
		const message = {
			role: role,
			content: content,
			metadata: metadata
		};

		if (name) {
			message.name = name;
		}

		return await this.addMessages(threadId, [message], false);
	},


	getUserContext: async function(threadId, mode = 'basic') {
		if (!zepClient) {
			return { success: false, error: 'Zep client not initialized', context: null };
		}

		try {
			const context = await zepClient.thread.getUserContext(threadId, {
				mode: mode
			});

			return {
				success: true, 
				context: context.context || '',
				summary: context.summary || null,
				facts: context.facts || [],
				entities: context.entities || [],
				metadata: context.metadata || {}
			};
		} catch (error) {
			console.error('Zep getUserContext error:', error);
			return { success: false, error: error.message, context: null };
		}
	},

	getMemory: async function(threadId, query = null, limit = 10) {
		if (!zepClient) {
			return { success: false, error: 'Zep client not initialized', memory: null };
		}

		try {
			if (query) {
				const userIdMatch = threadId.match(/^user-(.+)$/);
				if (userIdMatch) {
					const userId = userIdMatch[1];
					const searchResults = await zepClient.graph.search({
						userId: userId,
						query: query,
						scope: 'episodes',
						limit: limit
					});

					return { success: true, memory: searchResults, type: 'search' };
				} else {
					// Fallback to getUserContext if we can't extract userId
					return await this.getUserContext(threadId, 'basic');
				}
			} else {
				// Get recent context
				const context = await this.getUserContext(threadId, 'basic');
				return { success: true, memory: context, type: 'context' };
			}
		} catch (error) {
			console.error('Zep getMemory error:', error);
			return { success: false, error: error.message, memory: null };
		}
	},


	getSessionSummary: async function(threadId) {
		const context = await this.getUserContext(threadId, 'basic');
		
		return {
			success: context.success,
			summary: context.summary,
			facts: context.facts || [],
			metadata: context.metadata || {},
			error: context.error
		};
	},

	updateThreadMetadata: async function(threadId, metadata) {
		if (!zepClient) {
			return { success: false, error: 'Zep client not initialized' };
		}

		try {
			return { success: true, message: 'Metadata updates may require thread recreation' };
		} catch (error) {
			console.error('Zep updateThreadMetadata error:', error);
			return { success: false, error: error.message };
		}
	},

	deleteThread: async function(threadId) {
		if (!zepClient) {
			return { success: false, error: 'Zep client not initialized' };
		}

		try {
			await zepClient.thread.delete(threadId);
			return { success: true };
		} catch (error) {
			console.error('Zep deleteThread error:', error);
			return { success: false, error: error.message };
		}
	},

	getUserInsights: async function(userId) {
		if (!zepClient) {
			return { success: false, error: 'Zep client not initialized' };
		}

		try {
			const threads = await zepClient.user.getThreads(userId);

			const nodes = await zepClient.graph.node.getByUserId(userId, {});

			return {
				success: true,
				threads: threads || [],
				nodes: nodes || [],
				insights: {
					threadCount: threads?.length || 0,
					nodeCount: nodes?.length || 0
				}
			};
		} catch (error) {
			console.error('Zep getUserInsights error:', error);
			return { success: false, error: error.message };
		}
	}
};
