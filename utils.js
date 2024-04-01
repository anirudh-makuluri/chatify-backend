module.exports = {
	genRoomId: (uid1, uid2) => {
		const sortedUids = [uid1, uid2].sort();
  
  
		const roomId = sortedUids.join('_');
		
		return roomId;
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