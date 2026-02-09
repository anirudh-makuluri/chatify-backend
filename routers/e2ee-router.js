const express = require('express');
const config = require('../config');

const router = express.Router();

const KEY_MIN_LENGTH = 43;
const KEY_MAX_LENGTH = 44;
const ROOM_KEYS_CACHE_TTL_SECONDS = 300;
const IDENTITY_KEY_CACHE_TTL_SECONDS = 3600;
const DEVICE_ID_MIN_LENGTH = 4;
const DEVICE_ID_MAX_LENGTH = 128;

const cacheStore = new Map();

function cacheGet(key) {
	const entry = cacheStore.get(key);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		cacheStore.delete(key);
		return null;
	}
	return entry.value;
}

function cacheSet(key, value, ttlSeconds) {
	cacheStore.set(key, {
		value,
		expiresAt: Date.now() + ttlSeconds * 1000
	});
}

function cacheInvalidate(prefixOrKey) {
	if (!prefixOrKey) return;
	for (const key of cacheStore.keys()) {
		if (key === prefixOrKey || key.startsWith(prefixOrKey)) {
			cacheStore.delete(key);
		}
	}
}

function isValidBase64Key(value) {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (trimmed.length < KEY_MIN_LENGTH || trimmed.length > KEY_MAX_LENGTH) return false;
	if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) return false;
	try {
		const normalized = Buffer.from(trimmed, 'base64').toString('base64');
		const strippedInput = trimmed.replace(/=+$/, '');
		const strippedNormalized = normalized.replace(/=+$/, '');
		return strippedInput === strippedNormalized;
	} catch (error) {
		return false;
	}
}

function isValidBase64Payload(value) {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) return false;
	try {
		const normalized = Buffer.from(trimmed, 'base64').toString('base64');
		const strippedInput = trimmed.replace(/=+$/, '');
		const strippedNormalized = normalized.replace(/=+$/, '');
		return strippedInput === strippedNormalized;
	} catch (error) {
		return false;
	}
}

function isValidDeviceId(value) {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (trimmed.length < DEVICE_ID_MIN_LENGTH || trimmed.length > DEVICE_ID_MAX_LENGTH) return false;
	return /^[A-Za-z0-9._:-]+$/.test(trimmed);
}

async function requireSession(req, res, next) {
	const sessionCookie = req.cookies?.session || '';
	if (!sessionCookie) {
		return res.status(401).json({ error: 'No session found, please login' });
	}
	try {
		const decoded = await config.firebase.admin.auth().verifySessionCookie(sessionCookie, true);
		req.uid = decoded.uid;
		req.user = decoded;
		return next();
	} catch (error) {
		res.clearCookie('session');
		return res.status(401).json({ error: 'Session invalid, please login again' });
	}
}

async function getRoomInfo(roomId) {
	const roomRef = config.firebase.db.collection('rooms').doc(roomId);
	const roomSnap = await roomRef.get();
	if (!roomSnap.exists) return null;
	const roomData = roomSnap.data();
	return { roomRef, roomData };
}

function isRoomMember(roomData, userId) {
	const members = roomData?.members || [];
	return members.includes(userId);
}

function isRoomAdmin(roomData, userId) {
	if (!roomData) return false;
	if (roomData.created_by && roomData.created_by === userId) return true;
	const admins = roomData.admins || [];
	return Array.isArray(admins) && admins.includes(userId);
}

router.post('/auth/setup-keys', requireSession, async (req, res) => {
	try {
		const { userId, identityPublicKey, deviceId, deviceName } = req.body || {};
		if (!userId || typeof userId !== 'string') {
			return res.status(400).json({ error: 'userId is required' });
		}
		if (!isValidDeviceId(deviceId)) {
			return res.status(400).json({ error: 'deviceId is required' });
		}
		if (req.uid !== userId) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		if (!isValidBase64Key(identityPublicKey)) {
			return res.status(400).json({ error: 'Invalid key format' });
		}

		const userRef = config.firebase.db.collection('auth_users').doc(userId);
		await userRef.set({
			uid: userId,
			updatedAt: config.firebase.admin.firestore.FieldValue.serverTimestamp()
		}, { merge: true });

		const deviceRef = userRef.collection('identity_keys').doc(deviceId);
		const existingDeviceSnap = await deviceRef.get();
		const existingDevice = existingDeviceSnap.exists ? existingDeviceSnap.data() : null;
		const version = existingDevice?.version || 1;
		const createdAt = existingDevice?.createdAt || config.firebase.admin.firestore.FieldValue.serverTimestamp();

		await deviceRef.set({
			userId,
			deviceId,
			deviceName: typeof deviceName === 'string' ? deviceName.trim() : '',
			publicKey: identityPublicKey,
			version,
			createdAt,
			updatedAt: config.firebase.admin.firestore.FieldValue.serverTimestamp()
		});

		cacheInvalidate(`identity:${userId}`);
		cacheInvalidate(`identity:${userId}:${deviceId}`);

		return res.json({ success: true, message: 'User identity key stored successfully', deviceId });
	} catch (error) {
		console.error('Setup keys error:', error);
		return res.status(500).json({ error: 'Failed to store identity key' });
	}
});

router.post('/rooms/:roomId/members/add-key', requireSession, async (req, res) => {
	try {
		const { roomId } = req.params;
		const { userId, roomPublicKey, deviceId, deviceName } = req.body || {};

		if (!roomId) return res.status(400).json({ error: 'roomId is required' });
		if (!userId || typeof userId !== 'string') {
			return res.status(400).json({ error: 'userId is required' });
		}
		if (!isValidDeviceId(deviceId)) {
			return res.status(400).json({ error: 'deviceId is required' });
		}
		if (!isValidBase64Key(roomPublicKey)) {
			return res.status(400).json({ error: 'Invalid key format' });
		}

		const roomInfo = await getRoomInfo(roomId);
		if (!roomInfo) return res.status(404).json({ error: 'Room not found' });
		const { roomData, roomRef } = roomInfo;

		const isActor = req.uid === userId;
		if (!isActor && !isRoomAdmin(roomData, req.uid)) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		if (!isRoomMember(roomData, userId)) {
			return res.status(403).json({ error: 'User is not a member of this room' });
		}

		const identityDeviceSnap = await config.firebase.db.collection('auth_users')
			.doc(userId)
			.collection('identity_keys')
			.doc(deviceId)
			.get();

		if (!identityDeviceSnap.exists) {
			return res.status(400).json({ error: 'User identity key for device not found' });
		}

		const keyDocId = `${userId}_${deviceId}`;
		const deviceRef = roomRef.collection('keys').doc(keyDocId);
		const existingDeviceSnap = await deviceRef.get();
		const existingDevice = existingDeviceSnap.exists ? existingDeviceSnap.data() : null;
		const derivationVersion = existingDevice?.derivationVersion || 1;
		const createdAt = existingDevice?.createdAt || config.firebase.admin.firestore.FieldValue.serverTimestamp();

		await deviceRef.set({
			userId,
			roomId,
			deviceId,
			deviceName: typeof deviceName === 'string' ? deviceName.trim() : '',
			publicKey: roomPublicKey,
			derivationVersion,
			createdAt,
			updatedAt: config.firebase.admin.firestore.FieldValue.serverTimestamp()
		});

		cacheInvalidate(`room:${roomId}`);

		return res.json({ success: true, message: 'Room key stored successfully', deviceId });
	} catch (error) {
		console.error('Add room key error:', error);
		return res.status(500).json({ error: 'Failed to store room key' });
	}
});

router.get('/rooms/:roomId/members/public-keys', requireSession, async (req, res) => {
	try {
		const { roomId } = req.params;
		if (!roomId) return res.status(400).json({ error: 'roomId is required' });

		const roomInfo = await getRoomInfo(roomId);
		if (!roomInfo) return res.status(404).json({ error: 'Room not found' });
		const { roomData, roomRef } = roomInfo;

		if (!isRoomMember(roomData, req.uid)) {
			return res.status(403).json({ error: 'Not a member of this room' });
		}

		const cacheKey = `room:${roomId}`;
		const cached = cacheGet(cacheKey);
		if (cached) return res.json(cached);

		const members = {};
		const activeMembers = Array.isArray(roomData.members) ? roomData.members : [];
		const activeSet = new Set(activeMembers);

		const keysSnap = await roomRef.collection('keys').where('userId', 'in', activeMembers).get();


		keysSnap.forEach((doc) => {
			const data = doc.data() || {};
			if (!data.userId || !data.deviceId || !data.publicKey) return;
			if (!activeSet.has(data.userId)) return;
			if (!members[data.userId]) members[data.userId] = {};
			members[data.userId][data.deviceId] = data.publicKey;
		});

		const response = {
			success: true,
			roomId,
			members,
			updatedAt: new Date().toISOString()
		};

		cacheSet(cacheKey, response, ROOM_KEYS_CACHE_TTL_SECONDS);

		return res.json(response);
	} catch (error) {
		console.error('Get room members keys error:', error);
		return res.status(500).json({ error: 'Failed to fetch room keys' });
	}
});

router.get('/users/:userId/identity-key', async (req, res) => {
	try {
		const { userId } = req.params;
		const deviceId = req.query?.deviceId;
		if (!userId) return res.status(400).json({ error: 'userId is required' });

		if (deviceId) {
			if (!isValidDeviceId(deviceId)) {
				return res.status(400).json({ error: 'Invalid deviceId' });
			}
			const deviceCacheKey = `identity:${userId}:${deviceId}`;
			const cached = cacheGet(deviceCacheKey);
			if (cached) return res.json(cached);

			const deviceSnap = await config.firebase.db.collection('auth_users')
				.doc(userId)
				.collection('identity_keys')
				.doc(deviceId)
				.get();
			if (!deviceSnap.exists) return res.status(404).json({ error: 'Identity key not found' });

			const data = deviceSnap.data() || {};
			const updatedAt = data.updatedAt && typeof data.updatedAt.toDate === 'function'
				? data.updatedAt.toDate().toISOString()
				: new Date().toISOString();

			const response = {
				success: true,
				userId,
				deviceId,
				publicKey: data.publicKey,
				version: data.version || 1,
				deviceName: data.deviceName || '',
				updatedAt
			};

			cacheSet(deviceCacheKey, response, IDENTITY_KEY_CACHE_TTL_SECONDS);
			return res.json(response);
		}

		const cacheKey = `identity:${userId}`;
		const cached = cacheGet(cacheKey);
		if (cached) return res.json(cached);

		const devicesSnap = await config.firebase.db.collection('auth_users')
			.doc(userId)
			.collection('identity_keys')
			.get();
		if (devicesSnap.empty) return res.status(404).json({ error: 'Identity key not found' });

		const devices = {};
		devicesSnap.forEach((doc) => {
			const data = doc.data() || {};
			if (data.deviceId && data.publicKey) {
				devices[data.deviceId] = {
					publicKey: data.publicKey,
					version: data.version || 1,
					deviceName: data.deviceName || '',
					updatedAt: data.updatedAt && typeof data.updatedAt.toDate === 'function'
						? data.updatedAt.toDate().toISOString()
						: new Date().toISOString()
				};
			}
		});

		const response = {
			success: true,
			userId,
			devices
		};

		cacheSet(cacheKey, response, IDENTITY_KEY_CACHE_TTL_SECONDS);
		return res.json(response);
	} catch (error) {
		console.error('Get identity key error:', error);
		return res.status(500).json({ error: 'Failed to fetch identity key' });
	}
});

router.delete('/rooms/:roomId/members/:userId/key', requireSession, async (req, res) => {
	try {
		const { roomId, userId } = req.params;
		const deviceId = req.query?.deviceId;
		if (!roomId || !userId) {
			return res.status(400).json({ error: 'roomId and userId are required' });
		}
		if (deviceId && !isValidDeviceId(deviceId)) {
			return res.status(400).json({ error: 'Invalid deviceId' });
		}

		const roomInfo = await getRoomInfo(roomId);
		if (!roomInfo) return res.status(404).json({ error: 'Room not found' });
		const { roomRef, roomData } = roomInfo;

		const isActor = req.uid === userId;
		if (!isActor && !isRoomAdmin(roomData, req.uid)) {
			return res.status(403).json({ error: 'Not authorized to remove this user from this room' });
		}

		const keysRef = roomRef.collection('keys');

		if (deviceId) {
			const keyDocId = `${userId}_${deviceId}`;
			await keysRef.doc(keyDocId).delete();
			cacheInvalidate(`room:${roomId}`);
			return res.json({ success: true, message: 'Device key removed from room', deviceId });
		}

		const keysSnap = await keysRef.where('userId', '==', userId).get();
		const batch = config.firebase.db.batch();
		keysSnap.forEach((doc) => {
			batch.delete(doc.ref);
		});
		batch.update(roomRef, {
			members: config.firebase.admin.firestore.FieldValue.arrayRemove(userId)
		});

		const userRef = config.firebase.db.collection('auth_users').doc(userId);
		batch.update(userRef, {
			joined_rooms: config.firebase.admin.firestore.FieldValue.arrayRemove(roomId)
		});

		await batch.commit();

		cacheInvalidate(`room:${roomId}`);

		return res.json({ success: true, message: 'User key removed from room' });
	} catch (error) {
		console.error('Delete room key error:', error);
		return res.status(500).json({ error: 'Failed to remove room key' });
	}
});

router.post('/users/:userId/rotate-keys', requireSession, async (req, res) => {
	try {
		const { userId } = req.params;
		const { newIdentityPublicKey, roomKeys, deviceId, deviceName } = req.body || {};

		if (!userId) return res.status(400).json({ error: 'userId is required' });
		if (req.uid !== userId) return res.status(403).json({ error: 'Forbidden' });
		if (!isValidDeviceId(deviceId)) {
			return res.status(400).json({ error: 'deviceId is required' });
		}
		if (!isValidBase64Key(newIdentityPublicKey)) {
			return res.status(400).json({ error: 'Invalid key format' });
		}

		if (roomKeys && typeof roomKeys !== 'object') {
			return res.status(400).json({ error: 'roomKeys must be an object' });
		}

		const userRef = config.firebase.db.collection('auth_users').doc(userId);
		const deviceRef = userRef.collection('identity_keys').doc(deviceId);
		const deviceSnap = await deviceRef.get();
		if (!deviceSnap.exists) return res.status(404).json({ error: 'Identity key not found' });

		const currentVersion = deviceSnap.data()?.version || 1;
		const nextVersion = currentVersion + 1;

		await userRef.set({
			uid: userId,
			updatedAt: config.firebase.admin.firestore.FieldValue.serverTimestamp()
		}, { merge: true });

		await deviceRef.set({
			userId,
			deviceId,
			deviceName: typeof deviceName === 'string' ? deviceName.trim() : (deviceSnap.data()?.deviceName || ''),
			publicKey: newIdentityPublicKey,
			version: nextVersion,
			updatedAt: config.firebase.admin.firestore.FieldValue.serverTimestamp()
		}, { merge: true });

		if (roomKeys) {
			for (const [roomId, roomPublicKey] of Object.entries(roomKeys)) {
				if (!isValidBase64Key(roomPublicKey)) {
					return res.status(400).json({ error: `Invalid key format for room ${roomId}` });
				}

				const roomInfo = await getRoomInfo(roomId);
				if (!roomInfo) {
					return res.status(404).json({ error: `Room not found: ${roomId}` });
				}

				const { roomData } = roomInfo;
				if (!isRoomMember(roomData, userId)) {
					return res.status(403).json({ error: `Not a member of room ${roomId}` });
				}

				const keyDocId = `${userId}_${deviceId}`;
				const deviceKeyRef = config.firebase.db.collection('rooms')
					.doc(roomId)
					.collection('keys')
					.doc(keyDocId);

				const existingKeySnap = await deviceKeyRef.get();
				const derivationVersion = existingKeySnap.exists
					? (existingKeySnap.data()?.derivationVersion || 1) + 1
					: 1;

				await deviceKeyRef.set({
					userId,
					roomId,
					deviceId,
					deviceName: typeof deviceName === 'string' ? deviceName.trim() : (existingKeySnap.data()?.deviceName || ''),
					publicKey: roomPublicKey,
					derivationVersion,
					updatedAt: config.firebase.admin.firestore.FieldValue.serverTimestamp()
				}, { merge: true });

				cacheInvalidate(`room:${roomId}`);
			}
		}

		cacheInvalidate(`identity:${userId}`);
		cacheInvalidate(`identity:${userId}:${deviceId}`);

		return res.json({ success: true, message: 'Keys rotated successfully', version: nextVersion, deviceId });
	} catch (error) {
		console.error('Rotate keys error:', error);
		return res.status(500).json({ error: 'Failed to rotate keys' });
	}
});

router.post('/rooms/:roomId/messages', requireSession, async (req, res) => {
	try {
		const { roomId } = req.params;
		const { recipients, senderId, senderKeys } = req.body || {};

		if (!roomId) return res.status(400).json({ error: 'roomId is required' });
		if (!senderId || typeof senderId !== 'string') {
			return res.status(400).json({ error: 'senderId is required' });
		}
		if (req.uid !== senderId) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		if (!recipients || typeof recipients !== 'object') {
			return res.status(400).json({ error: 'recipients is required' });
		}

		const roomInfo = await getRoomInfo(roomId);
		if (!roomInfo) return res.status(404).json({ error: 'Room not found' });
		const { roomData } = roomInfo;

		if (!isRoomMember(roomData, senderId)) {
			return res.status(403).json({ error: 'Not a member of this room' });
		}

		const members = Array.isArray(roomData.members) ? roomData.members : [];
		if (members.length > 100) {
			return res.status(400).json({ error: 'Room member limit exceeded' });
		}

		const recipientIds = Object.keys(recipients);
		const missingMembers = recipientIds.filter((id) => !members.includes(id));
		if (missingMembers.length > 0) {
			return res.status(400).json({ error: 'Invalid recipients' });
		}

		for (const recipientId of recipientIds) {
			const deviceMap = recipients[recipientId];
			if (!deviceMap || typeof deviceMap !== 'object') {
				return res.status(400).json({ error: `Invalid recipients for ${recipientId}` });
			}
			for (const [deviceId, payload] of Object.entries(deviceMap)) {
				if (!isValidDeviceId(deviceId)) {
					return res.status(400).json({ error: `Invalid deviceId for ${recipientId}` });
				}
				if (!payload || typeof payload !== 'object') {
					return res.status(400).json({ error: `Invalid payload for ${recipientId}:${deviceId}` });
				}
				if (!isValidBase64Payload(payload.ciphertext) || !isValidBase64Payload(payload.iv)) {
					return res.status(400).json({ error: `Invalid ciphertext/iv for ${recipientId}:${deviceId}` });
				}
			}
		}

		const messageRef = config.firebase.db.collection('messages')
			.doc(roomId)
			.collection('messages')
			.doc();

		await messageRef.set({
			senderId,
			recipients,
			senderKeys: senderKeys && typeof senderKeys === 'object' ? senderKeys : {},
			timestamp: config.firebase.admin.firestore.FieldValue.serverTimestamp()
		});

		cacheInvalidate(`room:${roomId}`);

		return res.json({ success: true, messageId: messageRef.id });
	} catch (error) {
		console.error('Send encrypted message error:', error);
		return res.status(500).json({ error: 'Failed to store encrypted message' });
	}
});

module.exports = router;
