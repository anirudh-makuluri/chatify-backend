const express = require('express');
const { createServer } = require('http')
const { Server } = require("socket.io");
const cookieParser = require('cookie-parser');
const admin = require('firebase-admin');
const cors = require('cors');
const fileUpload = require('express-fileupload');

const config = require('./config');

const sessionRouter = require('./routers/session-router');
const usersRouter = require('./routers/users-router');
const scheduledMessagesRouter = require('./routers/scheduled-messages-router');
const dbHelper = require('./helpers/db-helper');
const aiHelper = require('./helpers/ai-helper')
const zepHelper = require('./helpers/zep-helper');
const Room = require('./Room');
const SchedulerService = require('./helpers/scheduler-helper');
const searchRouter = require('./routers/search-router');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
	cors: {
		origin: config.allowedOrigins,
		methods: ['GET', 'POST'],
		credentials: true
	}
});

httpServer.listen(config.PORT, () => {
	console.log(`Server is running on port ${config.PORT}`);
})

app.use((req, res, next) => {
	const origin = req.headers.origin;
    if (config.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
	res.setHeader('Access-Control-Allow-Headers', "Origin, X-Requested-With, Content-Type, Accept");
	res.setHeader('Access-Control-Allow-Credentials', true);
	next();
});

const corsOptions = {
	origin: true, //included origin as true
	credentials: true, //included credentials as true
};

app.use(cors(corsOptions));

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(fileUpload());
app.use(sessionRouter);
app.use(usersRouter);
app.use('/api/scheduled-messages', scheduledMessagesRouter);
app.use('/api', searchRouter);


admin.initializeApp({
	credential: admin.credential.cert(config.serviceAccount),
	storageBucket: config.firebase.storageBucketName
})

config.firebase.admin = admin;
config.firebase.db = admin.firestore()
const bucket = admin.storage().bucket();
config.firebase.storageBucket = bucket;

configureStorageBucketCors();
async function configureStorageBucketCors() {
	await config.firebase.storageBucket.setCorsConfiguration([config.storageBucketCorsConfiguration])
	.then(() => console.log(`Bucket ${config.firebase.storageBucketName} is updated with the CORS config`))
	.catch(e => console.log(e));
}

const sessionStore = new Map();
const roomList = new Map();
const schedulerService = new SchedulerService(io, roomList);

// Start the scheduler service
schedulerService.start();

initIO();

function getRoomThreadId(roomId, roomData, userUid) {
	const members = roomData?.members || [];
	const humanMembers = members.filter(uid => uid !== 'ai-assistant');
	if (humanMembers.length >= 2) {
		return `room-${roomId}`;
	}
	return `room-${userUid}`;
}



function initIO() {
	function parseCookieString(cookieString) {
		const cookies = {};
		if (cookieString) {
			cookieString.split(';').forEach(token => {
				[key, value] = token.split('=');
				if (key && value) {
					cookies[key.trim()] = value.trim();
				}
			});
		}

		return cookies;
	}


    io.use(async (socket, next) => {
		const sessionCookie = parseCookieString(socket.handshake.headers.cookie).session || '';

		const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, false)
			.then(decodedClaims => decodedClaims).catch((err) => {
				console.error(err);
				return null;
			})


		console.log("socket.handshake.auth: ", socket.handshake.auth);
		console.log("-----------------------------------------------");

        if (decodedClaims) {
			socket.uid = decodedClaims.uid;
			socket.email = decodedClaims.email;
		} else {
			console.log("Could not get valid sessionCookie, cannot create websocket");
			return next(new Error("Could not get valid sessionCookie, cannot create websocket"));
		}

		const name = socket.handshake.auth.name;
		if (!name) {
			console.log("Invalid name");
			return next(new Error("invalid userName"));
		}

        socket.session = { currentSocketId: socket.id, name: name, uid: socket.uid, roomIds: [] };
		sessionStore.set(socket.uid, socket.session);
		console.log(`Adding ${socket.uid} to sessionStore`);
		console.log(sessionStore);
        try {
            // set user online on successful auth
            const userRef = config.firebase.db.collection('auth_users').doc(socket.uid);
			await userRef.update({ is_online: true });

			// fetch friend list for presence broadcasting
			const userSnap = await userRef.get();
			const userData = userSnap.exists ? userSnap.data() : {};
			socket.session.friendUids = userData.friend_list || [];


			for (const friendUid of socket.session.friendUids) {
				const friendSession = sessionStore.get(friendUid);
				if (friendSession) {
					io.to(friendSession.currentSocketId).emit('presence_update', {
						uid: socket.uid,
						is_online: true,
						last_seen: null
					});
				}
			}
        } catch (e) {
            console.error('Failed to set user online:', e);
        }
		return next();
	})


	io.on("connection", (socket) => {


		socket.on("join_room", async (roomId, callback) => {
			socket.join(roomId);
			socket.session.roomIds.push(roomId);
			console.log(`user with id-${socket.id} joined room - ${roomId}`);

			const roomRef = admin.firestore().collection('rooms').doc(roomId);
			const roomSnap = await roomRef.get();
			if (roomSnap == null || !roomSnap.exists) {
				return callback({ error: 'Room not found' });
			}

			const roomData = roomSnap.data();
			const isGroup = roomData.is_group;
			const members = roomData.members;
			const roomName = roomData.name || '';
			const photoUrl = roomData.photo_url || '';

			if (!roomList.has(roomId)) {
				roomList.set(roomId, new Room(roomId, io, roomRef, isGroup, members, roomName, photoUrl));
			}

			// Get or create Zep thread for this room (reuses existing thread if it exists)
			try {
				const zepThreadId = getRoomThreadId(roomId, roomData, socket.uid);
				const threadResult = await zepHelper.createThread(socket.uid, zepThreadId, {
					roomId: roomId,
					roomName: roomName,
					isGroup: isGroup
				});
				
				if (threadResult.success && threadResult.isNew) {
					console.log(`Created new Zep thread: ${zepThreadId}`);
				} else if (threadResult.success && !threadResult.isNew) {
					console.log(`Reusing existing Zep thread: ${zepThreadId}`);
				}
			} catch (error) {
				console.error('Failed to get/create Zep thread for room:', error);
			}
		});


		socket.on('load_chat_doc_from_db', async (data, callback) => {
			const roomId = data.roomId;

			if (!roomList.has(roomId)) {
				return callback({ error: "Room not found" });
			}

			const room = roomList.get(roomId);
			const response = await room.loadChatFromDb(data.curChatDocId);
			callback(response)
		})

		socket.on("chat_event_client_to_server", async (data) => {
			if (!roomList.has(data.roomId)) return;

			const room = roomList.get(data.roomId);
			await room.newChatEvent(data);

			if (data.roomId.startsWith('ai-assistant-') && data.userUid !== 'ai-assistant') {
				try {
					// Check if AI is disabled in this room
					const roomRef = config.firebase.db.collection('rooms').doc(data.roomId);
					const roomSnap = await roomRef.get();
					const roomData = roomSnap.exists ? roomSnap.data() : {};

					const roomContext = {
						isGroup: room.isGroup,
						roomName: room.roomName,
						memberCount: room.members.length,
						roomId: data.roomId
					};

					const zepThreadId = getRoomThreadId(data.roomId, roomData, data.userUid);

					const aiResponse = await aiHelper.generateChatResponse(
						data.chatInfo,
						roomContext,
						data.userUid,
						zepThreadId,
						data.isPrivateBubble || false
					);

					if (aiResponse.success) {
						const aiMessage = {
							id: require('uuid').v4(),
							roomId: data.roomId,
							userUid: 'ai-assistant',
							userName: 'Chatify AI',
							userPhoto: 'https://ui-avatars.com/api/?name=AI&background=6366f1&color=ffffff',
							type: 'text',
							chatInfo: aiResponse.response,
							time: aiResponse.timestamp,
							isAIMessage: true
						};

						// Send AI response as a chat event
						await room.newChatEvent(aiMessage);
					}
				} catch (error) {
					console.error('Auto AI Response Error:', error);
					// Don't fail the original message if AI response fails
				}
			}
		});


		socket.on('disconnect', async () => {
			console.log("A client disconnected :", socket.uid);
			const sessionId = socket.uid;
			console.log(`Deleting ${socket.uid} from sessionStore`)
			sessionStore.delete(sessionId);

            try {
                // mark user offline and update last seen
                const userRef = config.firebase.db.collection('auth_users').doc(socket.uid);
				const lastSeen = config.firebase.admin.firestore.FieldValue.serverTimestamp();
				await userRef.update({ is_online: false, last_seen: lastSeen });

				// notify online friends about this user's presence change
				const friendUids = socket.session.friendUids || [];
				for (const friendUid of friendUids) {
					const friendSession = sessionStore.get(friendUid);
					if (friendSession) {
						io.to(friendSession.currentSocketId).emit('presence_update', {
							uid: socket.uid,
							is_online: false,
							last_seen: Date.now()
						});
					}
				}
            } catch (e) {
                console.error('Failed to set user offline:', e);
            }

			const roomIds = socket.session.roomIds || [];
			roomIds.forEach((roomId) => {
				const usersInRoom = io.sockets.adapter.rooms.get(roomId);
				const numUsersInRoom = usersInRoom ? usersInRoom.size : 0;
				if (numUsersInRoom == 0) {
					roomList.delete(roomId);
					console.log(`Deleted ${roomId} from roomList`);
				}
			})
		});

		socket.on('send_friend_request_client_to_server', async ({ senderUid, receiverUid }, callback) => {
			try {
				const receiver = sessionStore.get(receiverUid);
				const response = await dbHelper.sendFriendRequest(senderUid, receiverUid);
				if (receiver) {
					const senderData = await dbHelper.getUserData(senderUid);
					io.to(receiver.currentSocketId).emit('send_friend_request_server_to_client', senderData);					
				}

				callback(response);
			} catch (error) {
				callback({ error });
			}
		});

		socket.on('respond_friend_request_client_to_server', async ({ uid, requestUid, isAccepted }, callback) => {
			try {
				const response = await dbHelper.respondFriendRequest(uid, requestUid, isAccepted);

				const requestedUser = sessionStore.get(requestUid);
				if(requestedUser && isAccepted) {
					const respondedUserData = await dbHelper.getUserData(uid);
					io.to(requestedUser.currentSocketId).emit('respond_friend_request_server_to_client', respondedUserData);
				}

				callback(response);
			} catch (error) {
				callback({ error })
			}
		});

		socket.on('update_user_data', async ({ uid, newData }, callback) => {
			try {
				const response = await dbHelper.updateUserData(uid, newData);

				if(newData.name != null && sessionStore.has(uid)) {
					const user = sessionStore.get(uid);
					user.name = newData.name;
				}

				callback(response);
			} catch (error) {
				callback({ error });
			}
		});

		socket.on('chat_reaction_client_to_server', async ({ reactionId, id, chatDocId, roomId, userUid, userName }, callback) => {
			try {
				if(!reactionId || !id || !chatDocId || !roomId || !userUid || !userName) throw "One or more information is missing"
				const room = roomList.get(roomId);
				const response = await room.updateReaction({ reactionId, id, chatDocId, userUid, userName });

				callback(response)
			} catch (error) {
				callback({ error })
			}
		})

		socket.on('chat_delete_client_to_server', async ({ id, chatDocId, roomId }, callback) => {
			try {
				if(!id || !chatDocId || !roomId) throw "One or more information is missing"

				const room = roomList.get(roomId);
				const response = await room.deleteChatMessage({ id, chatDocId });

				callback(response)
			} catch (error) {
				callback({ error })
			}
		})

		socket.on('chat_edit_client_to_server', async ({ id, chatDocId, roomId, newText }, callback) => {
			try {
				if(!id || !chatDocId || !roomId || !newText) throw "One or more information is missing"

				const room = roomList.get(roomId);
				const response = await room.editChatMessage({ id, chatDocId, newText});

				callback(response)
			} catch (error) {
				callback({ error })
			}
		})

		socket.on('chat_save_client_to_server', async ({ id, chatDocId, roomId }, callback) => {
			try {
				if(!id || !chatDocId || !roomId) throw "One or more information is missing"

				const room = roomList.get(roomId);
				const response = await room.saveChatMessage({ id, chatDocId});

				callback(response)
			} catch (error) {
				callback({ error })
			}
		})

		socket.on('ai_summarize_conversation', async ({ roomId }, callback) => {
			try {
				if (!roomId) throw "RoomId is required";

				const roomRef = config.firebase.db.collection('rooms').doc(roomId);
				const roomSnap = await roomRef.get();
				if (!roomSnap.exists) throw "Room not found";
				const roomData = roomSnap.data();

				const zepThreadId = getRoomThreadId(roomId, roomData, socket.uid);

				const summaryResult = await zepHelper.getSessionSummary(zepThreadId);
				
				if (summaryResult.success && summaryResult.summary) {
					callback({
						success: true,
						summary: summaryResult.summary,
						timestamp: new Date()
					});
				} else {
					callback({ 
						success: false, 
						error: 'No conversation to summarize yet' 
					});
				}

			} catch (error) {
				console.error('AI Summarize Error:', error);
				callback({ error: 'Failed to generate summary' });
			}
		});

		socket.on('ai_analyze_sentiment', async ({ message }, callback) => {
			try {
				if (!message) throw "Message is required";

				const sentiment = await aiHelper.analyzeSentiment(message);
				callback(sentiment);

			} catch (error) {
				console.error('AI Sentiment Error:', error);
				callback({ error: 'Failed to analyze sentiment' });
			}
		});

		socket.on('ai_smart_replies', async ({ message, roomId }, callback) => {
			try {
				if (!message) throw "Message is required";

				const smartReplies = await aiHelper.generateSmartReplies(message, []);
				callback(smartReplies);

			} catch (error) {
				console.error('AI Smart Replies Error:', error);
				callback({ error: 'Failed to generate smart replies' });
			}
		});

		// SCHEDULED MESSAGES EVENTS
		socket.on('schedule_message', async ({ scheduledMessage }, callback) => {
			try {
				if (!scheduledMessage.userUid || !scheduledMessage.roomId || !scheduledMessage.message || !scheduledMessage.scheduledTime) {
					throw "Required fields: userUid, roomId, message, scheduledTime";
				}

				// Verify user is authorized to schedule messages in this room
				const roomRef = config.firebase.db.collection('rooms').doc(scheduledMessage.roomId);
				const roomSnap = await roomRef.get();
				if (!roomSnap.exists) throw "Room not found";
				
				const roomData = roomSnap.data();
				if (!roomData.members.includes(scheduledMessage.userUid)) {
					throw "User not authorized to schedule messages in this room";
				}

				// Get user data for the scheduled message
				const userData = await dbHelper.getUserData(scheduledMessage.userUid);
				
				const response = await dbHelper.createScheduledMessage({
					...scheduledMessage,
					userName: userData.name,
					userPhoto: userData.photo_url
				});

				callback(response);
			} catch (error) {
				console.error('Schedule Message Error:', error);
				callback({ error: error.message || 'Failed to schedule message' });
			}
		});

		socket.on('get_scheduled_messages', async ({ userUid, roomId }, callback) => {
			try {
				if (!userUid) throw "userUid is required";

				const response = await dbHelper.getScheduledMessages(userUid, roomId);
				callback(response);
			} catch (error) {
				console.error('Get Scheduled Messages Error:', error);
				callback({ error: error.message || 'Failed to get scheduled messages' });
			}
		});

		socket.on('update_scheduled_message', async ({ scheduledMessageId, updates, userUid }, callback) => {
			try {
				if (!scheduledMessageId || !userUid) throw "scheduledMessageId and userUid are required";

				// Verify ownership
				const scheduledMessageRef = config.firebase.db.collection('scheduled_messages').doc(scheduledMessageId);
				const scheduledMessageSnap = await scheduledMessageRef.get();
				if (!scheduledMessageSnap.exists) throw "Scheduled message not found";
				
				const scheduledMessageData = scheduledMessageSnap.data();
				if (scheduledMessageData.userUid !== userUid) {
					throw "Unauthorized to update this scheduled message";
				}

				const response = await dbHelper.updateScheduledMessage(scheduledMessageId, updates);
				callback(response);
			} catch (error) {
				console.error('Update Scheduled Message Error:', error);
				callback({ error: error.message || 'Failed to update scheduled message' });
			}
		});

		socket.on('delete_scheduled_message', async ({ scheduledMessageId, userUid }, callback) => {
			try {
				if (!scheduledMessageId || !userUid) throw "scheduledMessageId and userUid are required";

				const response = await dbHelper.deleteScheduledMessage(scheduledMessageId, userUid);
				callback(response);
			} catch (error) {
				console.error('Delete Scheduled Message Error:', error);
				callback({ error: error.message || 'Failed to delete scheduled message' });
			}
		});

	});
}