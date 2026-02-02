const { InferenceClient } = require('@huggingface/inference');
require('dotenv').config();

const HF_TOKEN = process.env.HG_API_KEY;
const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

let client = null;
if (HF_TOKEN) {
	client = new InferenceClient(HF_TOKEN);
}

/**
 * Generate a vector embedding for the given text using Hugging Face.
 * @param {string} text - Input text to embed
 * @returns {Promise<number[]|null>} 384-dimensional vector or null if unavailable
 */
async function getEmbedding(text) {
	if (!client || !text || typeof text !== 'string') return null;
	const trimmed = text.trim();
	if (!trimmed) return null;

	try {
		const result = await client.featureExtraction({
			model: EMBEDDING_MODEL,
			inputs: trimmed,
			provider: 'hf-inference'
		});

		const vector = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
		return Array.isArray(vector) ? vector : null;
	} catch (err) {
		console.error('Vector embedder error:', err);
		return null;
	}
}

module.exports = {
	getEmbedding,
	EMBEDDING_MODEL
};
