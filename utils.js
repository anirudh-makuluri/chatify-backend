module.exports = {
	genRoomId: (uid1, uid2) => {
		const sortedUids = [uid1, uid2].sort();
  
  
		const roomId = sortedUids.join('_');
		
		return roomId;
	},

	/**
	 * Cosine similarity between two vectors (assumed same length).
	 * @param {number[]} a
	 * @param {number[]} b
	 * @returns {number} value in [-1, 1]
	 */
	cosineSimilarity: (a, b) => {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
		let dot = 0, normA = 0, normB = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}
		const denom = Math.sqrt(normA) * Math.sqrt(normB);
		return denom === 0 ? 0 : dot / denom;
	},

	formatDate: function(date) {
		const dateObject = new Date(date);
		let month = '' + (dateObject.getMonth() + 1),
		day = '' + dateObject.getDate(),
		year = dateObject.getFullYear(),
		hours = dateObject.getHours(),
		minutes = dateObject.getMinutes(),
		seconds = dateObject.getSeconds();
		if (month.length < 2)
			month = '0' + month;
		if (day.length < 2)
			day = '0' + day;
		if (hours < 10)
			hours = '0' + hours;
		if (minutes < 10)
			minutes = '0' + minutes;
		if (seconds < 10)
			seconds = '0' + seconds;
		return [year, month, day, hours, minutes, seconds].join('-');
	},

	/**
	 * Sanitize error messages to prevent exposing sensitive information
	 * @param {Error|string|object} error - The error to sanitize
	 * @returns {string} Sanitized error message
	 */
	sanitizeError: function(error) {
		if (!error) return 'An error occurred';
		
		// If it's an Error object, extract the message
		if (error instanceof Error) {
			const message = error.message || 'An error occurred';
			// Remove potential sensitive patterns
			return message.replace(/token|password|secret|key|credential/gi, '[REDACTED]');
		}
		
		// If it's a string, sanitize it
		if (typeof error === 'string') {
			return error.replace(/token|password|secret|key|credential/gi, '[REDACTED]');
		}
		
		// If it's an object, try to extract a safe message
		if (typeof error === 'object') {
			const message = error.message || error.error || 'An error occurred';
			return String(message).replace(/token|password|secret|key|credential/gi, '[REDACTED]');
		}
		
		return 'An error occurred';
	},

	/**
	 * Sanitize user input to prevent XSS attacks
	 * @param {string} input - The input string to sanitize
	 * @returns {string} Sanitized string
	 */
	sanitizeInput: function(input) {
		if (typeof input !== 'string') return input;
		
		return input
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#x27;')
			.replace(/\//g, '&#x2F;')
			.trim();
	},

	/**
	 * Validate and sanitize search query
	 * @param {string} query - The search query
	 * @param {number} maxLength - Maximum allowed length (default: 100)
	 * @returns {object} { isValid: boolean, sanitized: string, error?: string }
	 */
	validateSearchQuery: function(query, maxLength = 100) {
		if (!query || typeof query !== 'string') {
			return { isValid: false, sanitized: '', error: 'Search query is required' };
		}
		
		if (query.length > maxLength) {
			return { isValid: false, sanitized: '', error: `Search query must be less than ${maxLength} characters` };
		}
		
		// Remove potentially dangerous characters but keep alphanumeric, spaces, and common punctuation
		const sanitized = query.replace(/[<>\"'\/\\]/g, '').trim();
		
		if (sanitized.length === 0) {
			return { isValid: false, sanitized: '', error: 'Search query cannot be empty' };
		}
		
		return { isValid: true, sanitized };
	}
}