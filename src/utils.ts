module.exports = {
	genRoomId: (uid1, uid2) => {
		const sortedUids = [uid1, uid2].sort();


		const roomId = sortedUids.join('_');

		return roomId;
	},

	formatDate: function (date) {
		const dateObject = new Date(date);
		let month = (dateObject.getMonth() + 1).toString().padStart(2, '0'),
			day = dateObject.getDate().toString().padStart(2, '0'),
			year = dateObject.getFullYear(),
			hours = dateObject.getHours().toString().padStart(2, '0'),
			minutes = dateObject.getMinutes().toString().padStart(2, '0'),
			seconds = dateObject.getSeconds().toString().padStart(2, '0');

		return [year, month, day, hours, minutes, seconds].join('-');
	}

}