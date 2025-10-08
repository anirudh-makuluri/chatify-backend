const { GoogleGenAI } = require('@google/genai')

const ai = new GoogleGenAI({});

module.exports = {
	testPrompt: async function () {
		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash',
			contents: "Explain how AI works",
			config: {
				thinkingConfig: {
					thinkingBudget: 0
				}
			}
		})

		return response.text
	},

	// AI Chat Assistant Functions
	generateChatResponse: async function(message, chatHistory = [], roomContext = {}) {
		try {
			// Build context from chat history
			const contextMessages = chatHistory.slice(-10).map(msg => ({
				role: msg.userUid === 'ai-assistant' ? 'assistant' : 'user',
				content: msg.chatInfo || msg.content || ''
			}));

			// Create system prompt for AI personality
			const systemPrompt = `You are Chatify AI, a helpful and friendly AI assistant integrated into a chat application. 
			
			Personality:
			- Be conversational, helpful, and engaging
			- Use emojis appropriately to make conversations lively
			- Be concise but informative
			- Show interest in users' conversations
			- Offer helpful suggestions when appropriate
			
			Context:
			- Room type: ${roomContext.isGroup ? 'Group chat' : 'Private chat'}
			- Room name: ${roomContext.roomName || 'Chat'}
			- Number of members: ${roomContext.memberCount || 1}
			
			Guidelines:
			- Keep responses under 200 words
			- Be contextually relevant to the conversation
			- Don't repeat information unnecessarily
			- Ask follow-up questions when appropriate
			- Be supportive and encouraging`;

			const prompt = `${systemPrompt}\n\nRecent conversation:\n${contextMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n\nUser: ${message}\n\nAI:`;

			const response = await ai.models.generateContent({
				model: 'gemini-2.0-flash',
				contents: prompt,
				config: {
					thinkingConfig: {
						thinkingBudget: 0
					},
					temperature: 0.7,
					maxOutputTokens: 200
				}
			});

			return {
				success: true,
				response: response.text,
				timestamp: new Date()
			};

		} catch (error) {
			console.error('AI Response Error:', error);
			return {
				success: false,
				error: 'Sorry, I encountered an error. Please try again!',
				timestamp: new Date()
			};
		}
	},

	summarizeConversation: async function(chatHistory) {
		try {
			if (!chatHistory || chatHistory.length === 0) {
				return { success: false, error: 'No conversation to summarize' };
			}

			const conversationText = chatHistory
				.filter(msg => msg.userUid !== 'ai-assistant')
				.map(msg => `${msg.userName}: ${msg.chatInfo}`)
				.join('\n');

			const prompt = `Summarize this conversation in 2-3 sentences. Focus on main topics, decisions made, and key points discussed:\n\n${conversationText}`;

			const response = await ai.models.generateContent({
				model: 'gemini-2.0-flash',
				contents: prompt,
				config: {
					thinkingConfig: {
						thinkingBudget: 0
					},
					temperature: 0.3,
					maxOutputTokens: 150
				}
			});

			return {
				success: true,
				summary: response.text,
				timestamp: new Date()
			};

		} catch (error) {
			console.error('AI Summary Error:', error);
			return {
				success: false,
				error: 'Unable to generate summary at this time'
			};
		}
	},

	analyzeSentiment: async function(message) {
		try {
			const prompt = `Analyze the sentiment of this message and respond with only one word: positive, negative, or neutral.\n\nMessage: "${message}"`;

			const response = await ai.models.generateContent({
				model: 'gemini-2.0-flash',
				contents: prompt,
				config: {
					thinkingConfig: {
						thinkingBudget: 0
					},
					temperature: 0.1,
					maxOutputTokens: 10
				}
			});

			const sentiment = response.text.toLowerCase().trim();
			const validSentiments = ['positive', 'negative', 'neutral'];
			
			return {
				success: true,
				sentiment: validSentiments.includes(sentiment) ? sentiment : 'neutral',
				timestamp: new Date()
			};

		} catch (error) {
			console.error('AI Sentiment Error:', error);
			return {
				success: false,
				sentiment: 'neutral'
			};
		}
	},

	generateSmartReplies: async function(message, chatHistory = []) {
		try {
			const prompt = `Generate 3 short, helpful reply suggestions for this message. Each reply should be under 10 words and be conversational. Format as: 1. Reply1 2. Reply2 3. Reply3\n\nMessage: "${message}"`;

			const response = await ai.models.generateContent({
				model: 'gemini-2.0-flash',
				contents: prompt,
				config: {
					thinkingConfig: {
						thinkingBudget: 0
					},
					temperature: 0.8,
					maxOutputTokens: 100
				}
			});

			// Parse the response to extract individual replies
			const replies = response.text
				.split('\n')
				.map(line => line.replace(/^\d+\.\s*/, '').trim())
				.filter(reply => reply.length > 0 && reply.length < 50)
				.slice(0, 3);

			return {
				success: true,
				replies: replies,
				timestamp: new Date()
			};

		} catch (error) {
			console.error('AI Smart Replies Error:', error);
			return {
				success: false,
				replies: ['👍', 'Got it!', 'Thanks!']
			};
		}
	}
}