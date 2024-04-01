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

	async newChatEvent(chatEvent) {
		chatEvent.chatDocId = this.currentChatDocRef?.id;
		chatEvent.time = new Date();

		const chatObject = {
			id: chatEvent.chatId,
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
}