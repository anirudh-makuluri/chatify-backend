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
						photo_url: `https://ui-avatars.com/api/?name=${user.name.replaceAll(" ", "")}&length=1`,
						created_at: config.firebase.admin.firestore.FieldValue.serverTimestamp(),
						is_online: false,
						last_seen: config.firebase.admin.firestore.FieldValue.serverTimestamp(),
						friend_list: [],
						sent_friend_requests: [],
						received_friend_requests: [],
						joined_rooms: []
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
		const recFrndpromises = recFrndReqUids.map(uid => this.getUserData(uid));
		const recFrndReqData = await Promise.all(recFrndpromises);

		const sentFrndReqsUids = userData.sent_friend_requests || [];
		const sentFrndPromises = sentFrndReqsUids.map(uid => this.getUserData(uid));
		const sentFrndReqData = await Promise.all(sentFrndPromises);
		
		const frndListUids = userData.friend_list || [];
		const frndListPromises = frndListUids.map(uid => this.getUserData(uid));
		const frndListData = await Promise.all(frndListPromises);

		const joinedRoomIds = userData.joined_rooms || [];
		const rooms = await joinedRoomIds.reduce(async (accumulatorPromise, roomId) => {
			const accumulator = await accumulatorPromise;

			const roomSnap = await config.firebase.db.collection('rooms').doc(roomId).get();
			
			if(!roomSnap.exists) return accumulator;

			const roomData = roomSnap.data();
			let messages = [];
			const chatDocIds = roomData.chat_doc_ids || [];
			if(chatDocIds.length > 0) {
				const latestChatDocId = chatDocIds[chatDocIds.length - 1];
				const chatHistorySnap = await config.firebase.db.collection('rooms').doc(roomId).collection('chat_history').doc(latestChatDocId).get();
				if(chatHistorySnap.exists) {
					messages = chatHistorySnap.data().chat_history;
				}
			}

			if(roomData.is_ai_room) {
				accumulator.push({
					id: roomId,
					...roomData,
					messages: messages,
					membersData: [
						{
							uid: 'ai-assistant',
							name: 'Chatify AI',
							photo_url: 'https://ui-avatars.com/api/?name=AI&background=6366f1&color=ffffff',
							email: 'ai-assistant@chatify.com'
						}
					]
				})

				return accumulator;
			}


			const membersDataPromises = roomData.members.map(uid => this.getUserData(uid));

			const membersData = await Promise.all(membersDataPromises);

			if(roomData.is_group == false) {
				const otherUserUid = roomData.members[0] == uid ? roomData.members[1] : roomData.members[0];

				const reqData = frndListData.find(frnd => frnd.uid == otherUserUid);

				accumulator.push({
					id: roomId, 
					...roomData, 
					messages: messages,
					photo_url: reqData?.photo_url,
					name: reqData?.name,
					membersData
				})
			} else {
				accumulator.push({
					id: roomId,
					...roomData,
					messages: messages,
					membersData
				})
			}

			return accumulator;
		}, Promise.resolve([]));

		const lastSeenMs = userData.last_seen && typeof userData.last_seen.toMillis === 'function'
			? userData.last_seen.toMillis()
			: (typeof userData.last_seen === 'number' ? userData.last_seen : null);

		return {
			success: "Fetched user details",
			user: {
				email: userData.email,
				name: userData.name,
				photo_url: userData.photo_url,
				is_online: userData.is_online || false,
				last_seen: lastSeenMs,
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

		const lastSeenMs = userData.last_seen && typeof userData.last_seen.toMillis === 'function'
			? userData.last_seen.toMillis()
			: (typeof userData.last_seen === 'number' ? userData.last_seen : null);

		return {
			email: userData.email,
			name: userData.name,
			photo_url: userData.photo_url,
			uid: userData.uid,
			is_online: userData.is_online || false,
			last_seen: lastSeenMs
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

		if (sentFriendRequests.find(uid => uid == receiverUid) || receivedFriendRequests.find(uid => uid == receiverUid) || friendList.find(uid => uid == receiverUid)) {
			throw "Friend request already sent or the user is already your friend"
		}

		try {

			sentFriendRequests.push(receiverUid)

			const senderRef = senderSnapshot.ref

			await senderRef.update({
				sent_friend_requests: sentFriendRequests
			})

			const receivedFriendRequests = receiverData.received_friend_requests || [];

			receivedFriendRequests.push(senderUid)

			const receiverRef = receiverSnapshot.ref
			await receiverRef.update({
				received_friend_requests: receivedFriendRequests
			})

			return { success: `Successfully sent friend request from ${senderData.name} to ${receiverData.name}` }
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

			//Removing the uid from users received list and sent list
			const userIndex = receivedFriendRequests.findIndex(obj => obj == requestedUid);
			const reqIndex = sentFriendRequests.findIndex(obj => obj == uid);

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

			const roomId = genRoomId(requestedUid, uid);
			
			const userFriendList = userData.friend_list || [];
			const userJoinedRooms = userData.joined_rooms || [];

			userFriendList.push(requestedUid)
			userJoinedRooms.push(roomId)

			await userRef.update({
				friend_list: userFriendList,
				joined_rooms: userJoinedRooms
			})

			const reqUserFriendList = reqUserData.friend_list || [];
			const reqUserJoinedRooms = reqUserData.joined_rooms || [];

			reqUserFriendList.push(uid)
			reqUserJoinedRooms.push(roomId);

			await reqUserRef.update({
				friend_list: reqUserFriendList,
				joined_rooms: reqUserJoinedRooms
			})

			
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

	updateUserData: async function (uid, newData) {
		try {
			if(!uid) throw "uid not found"

			const userRef = config.firebase.db.collection('auth_users').doc(uid);
			const userSnap = await userRef.get();
			if(!userSnap.exists) {
				throw "User doesnt exist"
			} 

			await userRef.update(newData);
			return { success: `User: ${uid} updated successfully with data ${JSON.stringify(newData)}` }
		} catch (error) {
			throw error
		}
	}
	,

	// GROUPS
	createGroup: async function (creatorUid, { name, photoUrl, memberUids }) {
		if (!creatorUid) throw "creatorUid not found";
		if (!name || typeof name !== 'string') throw "Group name is required";

		const uniqueMembers = Array.from(new Set([creatorUid, ...(memberUids || [])]));
		if (uniqueMembers.length < 2) throw "Group must have at least 2 members";

		const roomId = `group_${require('uuid').v4()}`;
		const roomRef = config.firebase.db.collection('rooms').doc(roomId);

		const roomData = {
			roomId,
			members: uniqueMembers,
			is_group: true,
			name,
			photo_url: photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0ea5e9&color=ffffff`,
			created_at: new Date(),
			chat_doc_ids: []
		};

		await roomRef.set(roomData);

		// add roomId to each member's joined_rooms
		const batch = config.firebase.db.batch();
		for (const memberUid of uniqueMembers) {
			const userRef = config.firebase.db.collection('auth_users').doc(memberUid);
			batch.update(userRef, {
				joined_rooms: config.firebase.admin.firestore.FieldValue.arrayUnion(roomId)
			});
		}
		await batch.commit();

		return { success: "Group created", roomId, room: roomData };
	},

	addGroupMembers: async function (roomId, actorUid, memberUids) {
		if (!roomId) throw "roomId not found";
		if (!actorUid) throw "actorUid not found";
		if (!Array.isArray(memberUids) || memberUids.length === 0) throw "memberUids required";

		const roomRef = config.firebase.db.collection('rooms').doc(roomId);
		const roomSnap = await roomRef.get();
		if (!roomSnap.exists) throw "Room not found";
		const room = roomSnap.data();
		if (!room.is_group) throw "Not a group room";

		const currentMembers = room.members || [];
		const toAdd = memberUids.filter(uid => !currentMembers.includes(uid));
		if (toAdd.length === 0) return { success: "No new members to add", roomId };

		await roomRef.update({
			members: config.firebase.admin.firestore.FieldValue.arrayUnion(...toAdd)
		});

		const batch = config.firebase.db.batch();
		for (const uid of toAdd) {
			const userRef = config.firebase.db.collection('auth_users').doc(uid);
			batch.update(userRef, {
				joined_rooms: config.firebase.admin.firestore.FieldValue.arrayUnion(roomId)
			});
		}
		await batch.commit();

		return { success: "Members added", added: toAdd, roomId };
	},

	removeGroupMember: async function (roomId, actorUid, memberUid) {
		if (!roomId) throw "roomId not found";
		if (!actorUid) throw "actorUid not found";
		if (!memberUid) throw "memberUid required";

		const roomRef = config.firebase.db.collection('rooms').doc(roomId);
		const roomSnap = await roomRef.get();
		if (!roomSnap.exists) throw "Room not found";
		const room = roomSnap.data();
		if (!room.is_group) throw "Not a group room";

		await roomRef.update({
			members: config.firebase.admin.firestore.FieldValue.arrayRemove(memberUid)
		});

		const userRef = config.firebase.db.collection('auth_users').doc(memberUid);
		await userRef.update({
			joined_rooms: config.firebase.admin.firestore.FieldValue.arrayRemove(roomId)
		});

		return { success: "Member removed", removed: memberUid, roomId };
	},

	updateGroupInfo: async function (roomId, actorUid, { name, photoUrl }) {
		if (!roomId) throw "roomId not found";
		if (!actorUid) throw "actorUid not found";

		const updates = {};
		if (name) updates.name = name;
		if (photoUrl) updates.photo_url = photoUrl;
		if (Object.keys(updates).length === 0) return { success: "No updates", roomId };

		const roomRef = config.firebase.db.collection('rooms').doc(roomId);
		await roomRef.update(updates);
		return { success: "Group updated", roomId, updates };
	},

	deleteGroup: async function (roomId, actorUid) {
		if (!roomId) throw "roomId not found";
		if (!actorUid) throw "actorUid not found";

		const roomRef = config.firebase.db.collection('rooms').doc(roomId);
		const roomSnap = await roomRef.get();
		if (!roomSnap.exists) throw "Room not found";
		const room = roomSnap.data();
		if (!room.is_group) throw "Not a group room";

		// Remove roomId from each member's joined_rooms
		const batch = config.firebase.db.batch();
		for (const uid of room.members || []) {
			const userRef = config.firebase.db.collection('auth_users').doc(uid);
			batch.update(userRef, {
				joined_rooms: config.firebase.admin.firestore.FieldValue.arrayRemove(roomId)
			});
		}

		// Delete all chat_history subcollection documents
		const chatHistoryRef = roomRef.collection('chat_history');
		const chatDocsSnap = await chatHistoryRef.get();
		chatDocsSnap.forEach(doc => {
			batch.delete(doc.ref);
		});

		// Delete the room document itself
		batch.delete(roomRef);

		await batch.commit();
		return { success: "Group deleted", roomId };
	}
}