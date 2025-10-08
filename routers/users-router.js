const Router = require('express').Router;
const config = require('../config');
const dbHelper = require('../helpers/db-helper');
const { v4: UUID } = require("uuid")

const router = new Router();

router.get('/users/search-user', async (req, res) => {
	const searchUser = req.query.searchuser;

	if (!searchUser) {
		res.send({ error: "search user query not given" });
		return;
	}

	try {
		const requiredUsers = await dbHelper.getSearchedUsers(searchUser);

		res.send({ requiredUsers })
	} catch (error) {
		res.send({ error });
	}
});

router.put('/users/:uid/friend-request', async (req, res) => {
	const senderUid = req.params.uid;
	const receiverUid = req.query.receiveruid;

	try {
		const response = await dbHelper.sendFriendRequest(senderUid, receiverUid);

		res.send({ response });
	} catch (error) {
		res.send({ error })
	}
})

router.post("/users/:uid/respond-request", async (req, res) => {
	const uid = req.params.uid;
	const isAccepted = req.body.isAccepted;
	const requestUid = req.body.uid;

	try {
		const response = await dbHelper.respondFriendRequest(uid, requestUid, isAccepted);

		res.send({ response });
	} catch (error) {
		res.send({ error })
	}
})

router.post("/users/:uid/files", async function (req, res) {
	if (!req.files) {
		return res.status(400).send({ error: `Could not decode any files` });
	}

	if (!req.files.file) {
		return res.status(400).send({ error: `No file found with key "file"` });
	}

	if (!req.query.storagePath) {
		return res.status(400).send({ error: `No "storagePath" key found in query` });
	}

	const file = req.files.file;
	const storagePath = req.query.storagePath;

	const fileStorageRef = config.firebase.storageBucket.file(storagePath);
	const uploadedFileName = fileStorageRef.name;

	fileStorageRef.save(file.data)
	.then(() => {
		const uuid = UUID();

		fileStorageRef.setMetadata({
			metadata: {
				firebaseStorageDownloadTokens: uuid
			}
		}).then(() => {
			const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${config.firebase.storageBucketName}/o/${encodeURIComponent(uploadedFileName)}?alt=media&token=${uuid}`;
			res.send({ success: `Uploaded file to path: ${storagePath}`, downloadUrl });
		}).catch(err => {
			res.send({ error: `Count not get download URL: ${err}` });
		});
	}).catch(err => {
		res.send({ error: `Could not upload file: ${err}` });
	});
})

	// AI Assistant Routes
router.post("/users/:uid/ai-assistant/room", async function (req, res) {
	try {
		const userId = req.params.uid;
		
		if (!userId) {
			return res.status(400).send({ error: "User ID is required" });
		}

		// Create or get AI assistant room (only one per user)
		const aiRoomId = `ai-assistant-${userId}`;
		const roomRef = config.firebase.db.collection('rooms').doc(aiRoomId);
		
		// Check if AI room already exists
		const roomSnap = await roomRef.get();
		if (roomSnap.exists) {
			return res.send({ 
				success: true, 
				roomId: aiRoomId, 
				message: 'AI Assistant room already exists',
				room: {
					id: aiRoomId,
					...roomSnap.data()
				}
			});
		}

		// Create new AI assistant room
		const roomData = {
			roomId: aiRoomId,
			members: [userId, 'ai-assistant'],
			is_group: false,
			name: 'Chatify AI Assistant',
			photo_url: 'https://ui-avatars.com/api/?name=AI&background=6366f1&color=ffffff',
			created_at: new Date(),
			is_ai_room: true
		};

		await roomRef.set(roomData);

		// Add AI room to user's joined rooms
		const userRef = config.firebase.db.collection('auth_users').doc(userId);
		await userRef.update({
			joined_rooms: config.firebase.admin.firestore.FieldValue.arrayUnion(aiRoomId)
		});

		res.send({ 
			success: true, 
			roomId: aiRoomId,
			message: 'AI Assistant room created successfully',
			room: {
				id: aiRoomId,
				...roomData
			}
		});

	} catch (error) {
		console.error('AI Room Creation Error:', error);
		res.status(500).send({ error: 'Failed to create AI assistant room' });
	}
});

module.exports = router