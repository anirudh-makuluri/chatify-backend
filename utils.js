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
}