const config = require("../config")
const { genRoomId } = require("../utils")

module.exports = {
	createUser: async function (user) {
		if (!user.uid || !user.email) {
			return { error: "uid and email are required" }
		}

		return config.firebase.db.collection("auth_users").doc(user.uid).get()
			.then((snapshot) => {
				if(!user.name) {
					user.name = user.email.split('@')[0]
				}

				if (!snapshot.exists) {
					config.firebase.db.collection('auth_users').doc(user.uid).set({
						uid: user.uid,
						name: user.name,
						email: user.email,
						photo_url: `https://ui-avatars.com/api/?name=${user.name}&length=1`,
						created_at: new Date(),
						friend_list: [],
						sent_friend_requests: [],
						received_friend_requests: []
					})

					return { success: `User with uid: ${user.uid} and email: ${user.email} created successfully` }
				} else {
					return { success: "User already exists" }
				}
			})
	},

	getAuthUserData: async function(uid) {
		const snapshot = await config.firebase.db.collection('auth_users').doc(uid).get();

		if(!snapshot.exists) throw "User doesnt exist"

		const userData = snapshot.data();

		const recFrndReqUids = userData.received_friend_requests || [];
		const recFrndpromises = recFrndReqUids.map(data => this.getUserData(data.uid));
		const recFrndReqData = await Promise.all(recFrndpromises);

		const sentFrndReqsUids = userData.sent_friend_requests || [];
		const sentFrndPromises = sentFrndReqsUids.map(data => this.getUserData(data.uid));
		const sentFrndReqData = await Promise.all(sentFrndPromises);
		
		const frndListUids = userData.friend_list || [];
		const frndListPromises = frndListUids.map(data => this.getUserData(data.uid));
		const frndListData = await Promise.all(frndListPromises);

		const roomsSnap = await config.firebase.db.collection('rooms').where('members', 'array-contains', uid).get();

		const rooms = await roomsSnap.docs.reduce(async (accumulatorPromise, doc) => {
			const accumulator = await accumulatorPromise;

			const roomData = doc.data();
			let messages = [];
			const chatDocIds = roomData.chat_doc_ids || [];
			if(chatDocIds.length > 0) {
				const latestChatDocId = chatDocIds[chatDocIds.length - 1];
				const chatHistorySnap = await config.firebase.db.collection('rooms').doc(doc.id).collection('chat_history').doc(latestChatDocId).get();
				if(chatHistorySnap.exists) {
					messages = chatHistorySnap.data().chat_history;
				}
			}

			if(roomData.is_group == false) {
				const otherUserUid = roomData.members[0] == uid ? roomData.members[1] : roomData.members[0];

				const reqData = frndListData.find(frnd => frnd.uid == otherUserUid);

				accumulator.push({
					id: doc.id, 
					...roomData, 
					messages: messages,
					photo_url: reqData?.photo_url,
					name: reqData?.name,
				})
			} else {
				accumulator.push({
					id: doc.id,
					...roomData,
					messages: messages
				})
			}

			return accumulator;
		}, Promise.resolve([]));

		return {
			success: "Fetched user details",
			user: {
				email: userData.email,
				name: userData.name,
				photo_url: userData.photo_url,
				received_friend_requests: recFrndReqData,
				sent_friend_requests: sentFrndReqData,
				friend_list: frndListData,
				uid: userData.uid,
				rooms
			}
		}
	},

	getUserData: async function(uid) {
		const snapshot = await config.firebase.db.collection('auth_users').doc(uid).get();

		if(!snapshot.exists) throw "User doesnt exist"

		const userData = snapshot.data();

		return {
			email: userData.email,
			name: userData.name,
			photo_url: userData.photo_url,
			uid: userData.uid
		}
	},

	getSearchedUsers: async function (searchUser) {
		console.log(`Searching with term: ${searchUser}`);
		if (!searchUser) {
			throw { error: "searchUser not given" }
		}

		const requiredUsers = [];

		try {
			const querySnapshot = await config.firebase.db.collection('auth_users').where('email', '==', searchUser).get();


			querySnapshot.forEach((doc) => {
				const data = doc.data();
				const user = {
					name: data.name,
					uid: data.uid,
					email: data.email,
					photo_url: data.photo_url
				}
				requiredUsers.push(user);
			});

			const querySnapshotByName = await config.firebase.db.collection('auth_users').where('name', 'array-contains', searchUser.toLowerCase()).get();

			querySnapshotByName.forEach((doc) => {
				const data = doc.data();
				const user = {
					name: data.name,
					uid: data.uid,
					email: data.email,
					photo_url: data.photo_url
				}
				requiredUsers.push(user);
			});

			return requiredUsers;
		} catch (error) {
			throw error
		}
	},

	sendFriendRequest: async function (senderUid, receiverUid) {
		const senderSnapshot = await config.firebase.db.collection('auth_users').doc(senderUid).get();
		const receiverSnapshot = await config.firebase.db.collection('auth_users').doc(receiverUid).get();

		if (!senderSnapshot.exists || !receiverSnapshot.exists) throw "Sender or receiver not found"

		const senderData = senderSnapshot.data();
		const receiverData = receiverSnapshot.data();
		const sentFriendRequests = senderData.sent_friend_requests || [];
		const receivedFriendRequests = senderData.received_friend_requests || [];
		const friendList = senderData.friend_list || [];

		if (sentFriendRequests.find(user => user.uid == receiverUid) || receivedFriendRequests.find(user => user.uid == receiverUid) || friendList.find(user => user.uid == receiverUid)) {
			throw "Friend request already sent or the user is already your friend"
		}

		try {

			sentFriendRequests.push({
				uid: receiverUid
			})

			const senderRef = senderSnapshot.ref

			await senderRef.update({
				sent_friend_requests: sentFriendRequests
			})

			const receivedFriendRequests = receiverData.received_friend_requests || [];

			receivedFriendRequests.push({
				uid: senderUid
			})

			const receiverRef = receiverSnapshot.ref
			await receiverRef.update({
				received_friend_requests: receivedFriendRequests
			})

			return `Successfully sent friend request from ${senderData.name} to ${receiverData.name}`
		} catch (error) {
			throw error
		}
	},

	respondFriendRequest: async function(uid, requestedUid, isAccepted) {
		const userSnap = await config.firebase.db.collection('auth_users').doc(uid).get();
		const reqUserSnap = await config.firebase.db.collection('auth_users').doc(requestedUid).get();

		if (!userSnap.exists || !reqUserSnap.exists) throw "Sender or receiver not found"

		const userData = userSnap.data();
		const reqUserData = reqUserSnap.data();

		const receivedFriendRequests = userData.received_friend_requests || [];
		const sentFriendRequests = reqUserData.sent_friend_requests || [];

		try {
			const userIndex = receivedFriendRequests.findIndex(obj => obj.uid == requestedUid);
			const reqIndex = sentFriendRequests.findIndex(obj => obj.uid == uid);

			if(userIndex == -1 || reqIndex == -1) throw "Friend request not found";

			receivedFriendRequests.splice(userIndex, 1);
			sentFriendRequests.splice(reqIndex, 1);

			const userRef = userSnap.ref;
			await userRef.update({
				received_friend_requests: receivedFriendRequests
			})

			const reqUserRef = reqUserSnap.ref;
			await reqUserRef.update({
				sent_friend_requests: sentFriendRequests
			})

			if(!isAccepted) return { success: `Successfully declined request of ${reqUserData.name} from ${userData.name}` };
			
			const userFriendList = userData.friend_list || [];

			userFriendList.push({
				uid: requestedUid
			})

			await userRef.update({
				friend_list: userFriendList
			})

			const reqUserFriendList = reqUserData.friend_list || [];

			reqUserFriendList.push({
				uid: uid
			})

			await reqUserRef.update({
				friend_list: reqUserFriendList
			})

			const roomId = genRoomId(requestedUid, uid);
			const roomSnap = await config.firebase.db.collection('rooms').doc(roomId).get();
			if(roomSnap.exists) {
				return { success: `RoomId: ${roomId} already created` };
			}

			const roomRef = roomSnap.ref;
			await roomRef.set({
				roomId: roomId,
				members: [uid, requestedUid],
				is_group: false
			})

			return { success: `Successfully accepted request of ${reqUserData.name} from ${userData.name}` };			
		} catch (error) {
			throw error
		}

	},

	addChatMessageToDb: async function (chatEvent) {
		const roomId = chatEvent.roomId;
		const roomSnapshot = await config.firebase.db.collection('rooms').doc(roomId).get();

		if(roomSnapshot.exists) {

		}
	}
}