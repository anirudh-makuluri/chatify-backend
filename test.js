const { InferenceClient } = require('@huggingface/inference');
require('dotenv').config();

const hf_token = process.env.HG_API_KEY;
const hf = new InferenceClient(hf_token);

async function test() {

	console.log('Hugging Face API Token:', hf_token);


	const message = "Let's meet for dinner tomorrow at 7pm";
	const embedding = await generateEmbedding(message);

	console.log('Embedding vector:', embedding);
	console.log('Vector dimension:', embedding.length);
}

async function generateEmbedding(text) {
	if(!hf) return null;

	const result = await hf.featureExtraction({
		model: 'sentence-transformers/all-MiniLM-L6-v2',
		inputs: text
	});
	return result; // Returns 384-dimensional vector
}

module.exports = test;