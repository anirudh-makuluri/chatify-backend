const Router = require('express').Router;
const config = require('../config');
const dbHelper = require('../helpers/db-helper');
const { v4: UUID } = require("uuid");
const logger = require('../logger');
const utils = require('../utils');

const router = new Router();

router.get('/users/search-user', async (req, res) => {
	const searchUser = req.query.searchuser;

	if (!searchUser) {
		return res.status(400).json({ error: "search user query not given" });
	}

	// Validate and sanitize search query
	const validation = utils.validateSearchQuery(searchUser, 100);
	if (!validation.isValid) {
		return res.status(400).json({ error: validation.error });
	}

	try {
		const requiredUsers = await dbHelper.getSearchedUsers(validation.sanitized);

		res.json({ requiredUsers });
	} catch (error) {
		logger.error('Search user error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(500).json({ error: sanitizedError });
	}
});

router.put('/users/:uid/friend-request', async (req, res) => {
	const senderUid = req.params.uid;
	const receiverUid = req.query.receiveruid;

	try {
		const response = await dbHelper.sendFriendRequest(senderUid, receiverUid);

		res.json({ response });
	} catch (error) {
		logger.error('Send friend request error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(500).json({ error: sanitizedError });
	}
})

router.post("/users/:uid/respond-request", async (req, res) => {
	const uid = req.params.uid;
	const isAccepted = req.body.isAccepted;
	const requestUid = req.body.uid;

	try {
		const response = await dbHelper.respondFriendRequest(uid, requestUid, isAccepted);

		res.json({ response });
	} catch (error) {
		logger.error('Respond friend request error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(500).json({ error: sanitizedError });
	}
})

router.post("/users/:uid/files", async function (req, res) {
	if (!req.files) {
		return res.status(400).json({ error: `Could not decode any files` });
	}

	if (!req.files.file) {
		return res.status(400).json({ error: `No file found with key "file"` });
	}

	if (!req.query.storagePath) {
		return res.status(400).json({ error: `No "storagePath" key found in query` });
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
			res.json({ success: `Uploaded file to path: ${storagePath}`, downloadUrl });
		}).catch(err => {
			logger.error('File upload error:', err);
			const sanitizedError = utils.sanitizeError(err);
			res.status(500).json({ error: `Could not get download URL: ${sanitizedError}` });
		});
	}).catch(err => {
		logger.error('File upload error:', err);
		const sanitizedError = utils.sanitizeError(err);
		res.status(500).json({ error: `Could not upload file: ${sanitizedError}` });
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
			return res.json({ 
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

		res.json({ 
			success: true, 
			roomId: aiRoomId,
			message: 'AI Assistant room created successfully',
			room: {
				id: aiRoomId,
				...roomData
			}
		});

	} catch (error) {
		logger.error('AI Room Creation Error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(500).json({ error: 'Failed to create AI assistant room', details: sanitizedError });
	}
});

// GROUP CHAT ROUTES
// Create a new group
router.post('/users/:uid/groups', async (req, res) => {
	try {
		const creatorUid = req.params.uid;
		let { name, photoUrl, memberUids } = req.body || {};
		
		// Sanitize user inputs
		if (name) name = utils.sanitizeInput(name);
		if (photoUrl) photoUrl = utils.sanitizeInput(photoUrl);
		
		logger.debug('Creating group:', { creatorUid, name, memberUidsCount: memberUids?.length });
		const response = await dbHelper.createGroup(creatorUid, { name, photoUrl, memberUids });
		res.json(response);
	} catch (error) {
		logger.error('Create group error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(400).json({ error: sanitizedError });
	}
});

// Add group members
router.post('/users/:uid/groups/:roomId/members', async (req, res) => {
	try {
		const actorUid = req.params.uid;
		const roomId = req.params.roomId;
		const { memberUids } = req.body || {};
		const response = await dbHelper.addGroupMembers(roomId, actorUid, memberUids || []);
		res.json(response);
	} catch (error) {
		logger.error('Add group members error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(400).json({ error: sanitizedError });
	}
});

// Remove a member
router.delete('/users/:uid/groups/:roomId/members/:memberUid', async (req, res) => {
	try {
		const actorUid = req.params.uid;
		const roomId = req.params.roomId;
		const memberUid = req.params.memberUid;
		const response = await dbHelper.removeGroupMember(roomId, actorUid, memberUid);
		res.json(response);
	} catch (error) {
		logger.error('Remove group member error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(400).json({ error: sanitizedError });
	}
});

// Update group info (name/photo/ai settings)
router.patch('/users/:uid/groups/:roomId', async (req, res) => {
	try {
		const actorUid = req.params.uid;
		const roomId = req.params.roomId;
		let { name, photoUrl, aiDisabled } = req.body || {};
		
		// Sanitize user inputs
		if (name !== undefined) name = utils.sanitizeInput(name);
		if (photoUrl !== undefined) photoUrl = utils.sanitizeInput(photoUrl);
		
		const updates = {};
		if (name !== undefined) updates.name = name;
		if (photoUrl !== undefined) updates.photo_url = photoUrl;
		if (aiDisabled !== undefined) updates.ai_disabled = aiDisabled;
		const response = await dbHelper.updateGroupInfo(roomId, actorUid, updates);
		res.json(response);
	} catch (error) {
		logger.error('Update group info error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(400).json({ error: sanitizedError });
	}
});

// Delete group
router.delete('/users/:uid/groups/:roomId', async (req, res) => {
	try {
		const actorUid = req.params.uid;
		const roomId = req.params.roomId;
		const response = await dbHelper.deleteGroup(roomId, actorUid);
		res.json(response);
	} catch (error) {
		logger.error('Delete group error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(400).json({ error: sanitizedError });
	}
});

// Toggle AI for any room (enable/disable)
router.patch('/users/:uid/rooms/:roomId/ai', async (req, res) => {
	try {
		const actorUid = req.params.uid;
		const roomId = req.params.roomId;
		const { aiDisabled } = req.body || {};

		// Verify user is a member of the room
		const roomRef = config.firebase.db.collection('rooms').doc(roomId);
		const roomSnap = await roomRef.get();
		if (!roomSnap.exists) {
			return res.status(404).send({ error: 'Room not found' });
		}

		const roomData = roomSnap.data();
		if (!roomData.members || !roomData.members.includes(actorUid)) {
			return res.status(403).send({ error: 'User is not a member of this room' });
		}

		// Update AI setting
		await roomRef.update({ ai_disabled: aiDisabled === true });

		res.json({ 
			success: true, 
			message: `AI ${aiDisabled ? 'disabled' : 'enabled'} for room`,
			roomId,
			aiDisabled: aiDisabled === true
		});
	} catch (error) {
		logger.error('Toggle AI Error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(500).json({ error: sanitizedError || 'Failed to toggle AI' });
	}
});

module.exports = router