const config = require("./config");
const utils = require("./utils");

module.exports = class Room {
	constructor(roomId, io, roomRef, isGroup, members, roomName, photoUrl) {
		this.roomId = roomId;
		this.io = io;

		this.roomRef = roomRef;

		this.isGroup = isGroup;
		this.members = members;
		this.roomName = roomName;
		this.photoUrl = photoUrl

		this.currentChatDocRef = null;
		this.currentChatDocMsgCnt = 0;
		this.chatDocIds = [];
		this.initChatPromise = this.initChatDocDetails();

	}


	async initChatDocDetails() {
		const roomSnap = await this.roomRef.get();

		this.chatDocIds = roomSnap.data()?.chat_doc_ids || []

		if(this.chatDocIds?.length > 0) {
			this.currentChatDocRef = this.roomRef.collection('chat_history').doc(this.chatDocIds[this.chatDocIds.length - 1]);
			const currentChatDocSnap = await this.currentChatDocRef.get();
			this.currentChatDocMsgCnt = currentChatDocSnap.data()?.chat_history.length;
		}
	}

	async loadChatFromDb(curChatDocId) {
		let reqIdx = this.chatDocIds.length - 1;
		if(curChatDocId) {
			reqIdx = this.chatDocIds.findIndex(id => id == curChatDocId) - 1;
		}

		if(reqIdx < 0) return { error: 'No document found' };

		const reqChatDocSnap = await this.roomRef.collection('chat_history').doc(this.chatDocIds[reqIdx]).get();
		return { success: 'Successfully fetch chat doc', chat_history: reqChatDocSnap.data().chat_history };
	}

	async newChatEvent(chatEvent) {
		chatEvent.chatDocId = this.currentChatDocRef?.id;
		chatEvent.time = new Date();

		const chatObject = {
			id: chatEvent.id,
			chatDocId: chatEvent.chatDocId,
			userUid: chatEvent.userUid,
			type: chatEvent.type,
			chatInfo: chatEvent.chatInfo,
			fileName: chatEvent.fileName || '',
			userName: chatEvent.userName,
			userPhoto: chatEvent.userPhoto,
			isMsgEdited: chatEvent.isMsgEdited ?? false,
			isMsgSaved: chatEvent.isMsgSaved ?? false,
			time: chatEvent.time
		}

		if(this.currentChatDocMsgCnt >= config.chatDocSize || this.currentChatDocRef == null) {
			this.currentChatDocMsgCnt = 0;
			const currentChatDocId = utils.formatDate(new Date()) + '_chat';
			chatObject.chatDocId = currentChatDocId;
			chatEvent.chatDocId = currentChatDocId;
			this.currentChatDocRef = await this.roomRef.collection('chat_history').doc(currentChatDocId);
			await this.currentChatDocRef.set({
				chat_history: config.firebase.admin.firestore.FieldValue.arrayUnion(chatObject),
				created_at: new Date()
			}).then(async () => {
				await this.roomRef.update({
					chat_doc_ids: config.firebase.admin.firestore.FieldValue.arrayUnion(currentChatDocId)
				})

				this.currentChatDocMsgCnt++;
			})

			this.chatDocIds.push(currentChatDocId)
		} else {
			chatObject['chatDocId'] = this.chatDocIds[this.chatDocIds.length - 1];
			this.currentChatDocRef.update({
				chat_history: config.firebase.admin.firestore.FieldValue.arrayUnion(chatObject)
			}).then(() => {
				this.currentChatDocMsgCnt++;
			})
		}

		this.io.to(this.roomId).emit('chat_event_server_to_client', chatEvent)

		return { success: `Successfully sent chat msg to roomId: ${this.roomId}` };
	}


	async updateChatReaction({ reactionId, id, chatDocId, userUid, userName }) {
		const chatDocRef = this.roomRef.collection('chat_history').doc(chatDocId);
		const chatDocSnap = await chatDocRef.get();
		const chatHistory = chatDocSnap.data().chat_history;

		const reqIdx = chatHistory.findIndex(msg => msg.id == id)

		if(reqIdx == -1) throw "Required message not found";


		const reactions = chatHistory[reqIdx].reactions || [];

		const reqReactionIdx = reactions.findIndex(data => data.id == reactionId);

		if(reqReactionIdx == -1) {
			const newReactionItem = {
				id: reactionId,
				reactors: [{
					uid: userUid,
					name: userName
				}]
			}
			reactions.push(newReactionItem);
		} else {
			const reqReactorIdx = reactions[reqReactionIdx].reactors.findIndex(data => data.uid == userUid);

			if(reqReactionIdx == -1) {
				reactions[reqReactionIdx].reactors.push({
					uid: userUid,
					name: userName
				});
			} else {
				reactions[reqReactionIdx].reactors.splice(reqReactorIdx, 1);
				if(reactions[reqReactionIdx].reactors.length == 0) {
					reactions.splice(reqReactionIdx, 1)
				}
			}
		}

		chatHistory[reqIdx].reactions = reactions

		await chatDocRef.update({
			chat_history: chatHistory
		})

		this.io.to(this.roomId).emit('chat_reaction_server_to_client', { reactionId, id, chatDocId, userUid, userName, roomId: this.roomId })

		return { success: `Successfully sent chat reaction to roomId: ${this.roomId}` };
	}

	async deleteChatMessage({ id, chatDocId }){
		const chatDocRef = this.roomRef.collection('chat_history').doc(chatDocId);
		const chatDocSnap = await chatDocRef.get();
		const chatHistory = chatDocSnap.data().chat_history;

		const reqIdx = chatHistory.findIndex(msg => msg.id == id)

		if(reqIdx == -1) throw "Required message not found";

		chatHistory.splice(reqIdx, 1);

		await chatDocRef.update({
			chat_history: chatHistory
		})

		this.io.to(this.roomId).emit('chat_delete_server_to_client', { id, chatDocId, roomId: this.roomId })

		return { success: `Successfully deleted chat in roomId: ${this.roomId}` };
	}

	async editChatMessage({ id, chatDocId, newText }) {
		const chatDocRef = this.roomRef.collection('chat_history').doc(chatDocId);
		const chatDocSnap = await chatDocRef.get();
		const chatHistory = chatDocSnap.data().chat_history;

		const reqIdx = chatHistory.findIndex(msg => msg.id == id)

		if(reqIdx == -1) throw "Required message not found";

		chatHistory[reqIdx].chatInfo = newText
		chatHistory[reqIdx].isMsgEdited = true

		await chatDocRef.update({
			chat_history: chatHistory
		})

		this.io.to(this.roomId).emit('chat_edit_server_to_client', { id, chatDocId, roomId: this.roomId, newText })

		return { success: `Successfully edited chat in roomId: ${this.roomId}` };

	}

	async saveChatMessage({ id, chatDocId }){
		const chatDocRef = this.roomRef.collection('chat_history').doc(chatDocId);
		const chatDocSnap = await chatDocRef.get();
		const chatHistory = chatDocSnap.data().chat_history;

		const roomSnap = await this.roomRef.get();

		const reqIdx = chatHistory.findIndex(msg => msg.id == id)

		if(reqIdx == -1) throw "Required message not found";

		const isMsgSaved = chatHistory[reqIdx].isMsgSaved || false;

		if(isMsgSaved) {
			chatHistory[reqIdx].isMsgSaved = false;

			const savedMessages = roomSnap.data().saved_messages || [];

			const reqSavedMsgIdx = savedMessages.findIndex(msg => msg.id == id);

			if(reqSavedMsgIdx != -1) {
				savedMessages.splice(reqSavedMsgIdx, 1);
				
				await this.roomRef.update({
					saved_messages: savedMessages
				})
			}
		} else {
			chatHistory[reqIdx].isMsgSaved = true;

			await this.roomRef.update({
				saved_messages: config.firebase.admin.firestore.FieldValue.arrayUnion({
					...chatHistory[reqIdx]
				})
			})

		}

		await chatDocRef.update({
			chat_history: chatHistory,
		})

		this.io.to(this.roomId).emit('chat_save_server_to_client', { id, chatDocId, roomId: this.roomId })

		return { success: `Successfully saved chat in roomId: ${this.roomId}` };
	}
}