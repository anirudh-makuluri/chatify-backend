const express = require('express');
const { createServer } = require('http')
const { Server } = require("socket.io");
const cookieParser = require('cookie-parser');
const admin = require('firebase-admin');
const cors = require('cors');

const config = require('./config');

const sessionRouter = require('./routers/session-router');
const usersRouter = require('./routers/users-router');
const dbHelper = require('./helpers/db-helper');
const Room = require('./Room');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
	cors: {
		origin: "http://localhost:3000",
		methods: ['GET', 'POST'],
		credentials: true
	}
});

httpServer.listen(config.PORT, () => {
	console.log(`Server is running on port ${config.PORT}`);
})

app.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
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
app.use(sessionRouter);
app.use(usersRouter);


admin.initializeApp({
	credential: admin.credential.cert(config.serviceAccount)
})

config.firebase.admin = admin;
config.firebase.db = admin.firestore()

const sessionStore = new Map();
const roomList = new Map();
initIO();

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
		return next();
	})


	io.on("connection", (socket) => {


		socket.on("join_room", async (roomId, callback) => {
			socket.join(roomId);
			socket.session.roomIds.push(roomId);
			console.log(`user with id-${socket.id} joined room - ${roomId}`);

			if (roomList.has(roomId)) return;

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

			roomList.set(roomId, new Room(roomId, io, roomRef, isGroup, members, roomName, photoUrl));
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

		socket.on("chat_event_client_to_server", (data) => {
			if (!roomList.has(data.roomId)) return;

			const room = roomList.get(data.roomId);
			room.newChatEvent(data);
		});


		socket.on('disconnect', () => {
			console.log("A client disconnected :", socket.uid);
			const sessionId = socket.uid;
			console.log(`Deleting ${socket.uid} from sessionStore`)
			sessionStore.delete(sessionId);

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

	});
}