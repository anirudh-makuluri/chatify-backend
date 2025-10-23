const express = require('express');
const router = express.Router();
const dbHelper = require('../helpers/db-helper');

// Middleware to verify authentication
const verifyAuth = async (req, res, next) => {
	try {
		const sessionCookie = req.cookies.session || '';
		const admin = require('firebase-admin');
		
		const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, false);
		if (!decodedClaims) {
			return res.status(401).json({ error: 'Unauthorized' });
		}
		
		req.user = decodedClaims;
		next();
	} catch (error) {
		console.error('Auth verification error:', error);
		res.status(401).json({ error: 'Unauthorized' });
	}
};

// Create a scheduled message
router.post('/schedule', verifyAuth, async (req, res) => {
	try {
		const { roomId, message, messageType, fileName, scheduledTime, recurring, recurringPattern, timezone } = req.body;
		const userUid = req.user.uid;

		if (!roomId || !message || !scheduledTime) {
			return res.status(400).json({ error: 'Required fields: roomId, message, scheduledTime' });
		}

		// Verify user is authorized to schedule messages in this room
		const roomRef = require('firebase-admin').firestore().collection('rooms').doc(roomId);
		const roomSnap = await roomRef.get();
		if (!roomSnap.exists) {
			return res.status(404).json({ error: 'Room not found' });
		}
		
		const roomData = roomSnap.data();
		if (!roomData.members.includes(userUid)) {
			return res.status(403).json({ error: 'User not authorized to schedule messages in this room' });
		}

		// Get user data
		const userData = await dbHelper.getUserData(userUid);
		
		const scheduledMessage = {
			userUid,
			roomId,
			message,
			messageType: messageType || 'text',
			fileName: fileName || '',
			scheduledTime,
			recurring: recurring || false,
			recurringPattern: recurringPattern || null,
			timezone: timezone || 'UTC',
			userName: userData.name,
			userPhoto: userData.photo_url
		};

		const response = await dbHelper.createScheduledMessage(scheduledMessage);
		res.json(response);
	} catch (error) {
		console.error('Create scheduled message error:', error);
		res.status(500).json({ error: error.message || 'Failed to create scheduled message' });
	}
});

// Get scheduled messages for a user
router.get('/user/:userUid', verifyAuth, async (req, res) => {
	try {
		const { userUid } = req.params;
		const { roomId } = req.query;

		// Verify user can only access their own scheduled messages
		if (req.user.uid !== userUid) {
			return res.status(403).json({ error: 'Unauthorized to access these scheduled messages' });
		}

		const response = await dbHelper.getScheduledMessages(userUid, roomId);
		res.json(response);
	} catch (error) {
		console.error('Get scheduled messages error:', error);
		res.status(500).json({ error: error.message || 'Failed to get scheduled messages' });
	}
});

// Update a scheduled message
router.put('/:scheduledMessageId', verifyAuth, async (req, res) => {
	try {
		const { scheduledMessageId } = req.params;
		const updates = req.body;
		const userUid = req.user.uid;

		// Verify ownership
		const scheduledMessageRef = require('firebase-admin').firestore().collection('scheduled_messages').doc(scheduledMessageId);
		const scheduledMessageSnap = await scheduledMessageRef.get();
		if (!scheduledMessageSnap.exists) {
			return res.status(404).json({ error: 'Scheduled message not found' });
		}
		
		const scheduledMessageData = scheduledMessageSnap.data();
		if (scheduledMessageData.userUid !== userUid) {
			return res.status(403).json({ error: 'Unauthorized to update this scheduled message' });
		}

		const response = await dbHelper.updateScheduledMessage(scheduledMessageId, updates);
		res.json(response);
	} catch (error) {
		console.error('Update scheduled message error:', error);
		res.status(500).json({ error: error.message || 'Failed to update scheduled message' });
	}
});

// Delete a scheduled message
router.delete('/:scheduledMessageId', verifyAuth, async (req, res) => {
	try {
		const { scheduledMessageId } = req.params;
		const userUid = req.user.uid;

		const response = await dbHelper.deleteScheduledMessage(scheduledMessageId, userUid);
		res.json(response);
	} catch (error) {
		console.error('Delete scheduled message error:', error);
		res.status(500).json({ error: error.message || 'Failed to delete scheduled message' });
	}
});

// Get scheduled messages for a specific room
router.get('/room/:roomId', verifyAuth, async (req, res) => {
	try {
		const { roomId } = req.params;
		const userUid = req.user.uid;

		// Verify user is a member of the room
		const roomRef = require('firebase-admin').firestore().collection('rooms').doc(roomId);
		const roomSnap = await roomRef.get();
		if (!roomSnap.exists) {
			return res.status(404).json({ error: 'Room not found' });
		}
		
		const roomData = roomSnap.data();
		if (!roomData.members.includes(userUid)) {
			return res.status(403).json({ error: 'User not authorized to access scheduled messages in this room' });
		}

		const response = await dbHelper.getScheduledMessages(userUid, roomId);
		res.json(response);
	} catch (error) {
		console.error('Get room scheduled messages error:', error);
		res.status(500).json({ error: error.message || 'Failed to get room scheduled messages' });
	}
});

module.exports = router;
