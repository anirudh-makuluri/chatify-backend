const cron = require('node-cron');
const config = require('../config');
const dbHelper = require('./db-helper');
const Room = require('../Room');

class SchedulerService {
	constructor(io, roomList) {
		this.io = io;
		this.roomList = roomList;
		this.isRunning = false;
	}

	start() {
		if (this.isRunning) {
			console.log('Scheduler is already running');
			return;
		}

		console.log('Starting scheduled message scheduler...');
		this.isRunning = true;

		// Check for pending scheduled messages every minute
		cron.schedule('* * * * *', async () => {
			await this.processScheduledMessages();
		});

		console.log('Scheduled message scheduler started');
	}

	stop() {
		if (!this.isRunning) {
			console.log('Scheduler is not running');
			return;
		}

		console.log('Stopping scheduled message scheduler...');
		this.isRunning = false;
		console.log('Scheduled message scheduler stopped');
	}

	async processScheduledMessages() {
		try {
			const pendingMessages = await dbHelper.getPendingScheduledMessages();
			
			if (pendingMessages.length === 0) {
				return;
			}

			console.log(`Processing ${pendingMessages.length} scheduled messages...`);

			for (const scheduledMessage of pendingMessages) {
				try {
					await this.sendScheduledMessage(scheduledMessage);
				} catch (error) {
					console.error(`Error processing scheduled message ${scheduledMessage.id}:`, error);
				}
			}
		} catch (error) {
			console.error('Error processing scheduled messages:', error);
		}
	}

	async sendScheduledMessage(scheduledMessage) {
		try {
			const { roomId, userUid, message, messageType, fileName, userName, userPhoto } = scheduledMessage;

			// Ensure room is loaded in roomList
			if (!this.roomList.has(roomId)) {
				await this.loadRoom(roomId);
			}

			const room = this.roomList.get(roomId);
			if (!room) {
				console.error(`Room ${roomId} not found for scheduled message ${scheduledMessage.id}`);
				return;
			}

			// Create the chat event for the scheduled message
			const chatEvent = {
				id: require('uuid').v4(),
				roomId: roomId,
				userUid: userUid,
				userName: userName,
				userPhoto: userPhoto,
				type: messageType || 'text',
				chatInfo: message,
				fileName: fileName || '',
				isScheduledMessage: true,
				originalScheduledMessageId: scheduledMessage.id
			};

			// Send the message through the room
			await room.newChatEvent(chatEvent);

			// Mark the scheduled message as sent
			await dbHelper.markScheduledMessageAsSent(scheduledMessage.id);

			console.log(`Scheduled message ${scheduledMessage.id} sent successfully to room ${roomId}`);

			// Handle recurring messages
			if (scheduledMessage.recurring && scheduledMessage.recurringPattern) {
				await this.scheduleNextRecurringMessage(scheduledMessage);
			}

		} catch (error) {
			console.error(`Error sending scheduled message ${scheduledMessage.id}:`, error);
			throw error;
		}
	}

	async loadRoom(roomId) {
		try {
			const roomRef = config.firebase.db.collection('rooms').doc(roomId);
			const roomSnap = await roomRef.get();
			
			if (!roomSnap.exists) {
				throw new Error(`Room ${roomId} not found`);
			}

			const roomData = roomSnap.data();
			const isGroup = roomData.is_group;
			const members = roomData.members;
			const roomName = roomData.name || '';
			const photoUrl = roomData.photo_url || '';

			const room = new Room(roomId, this.io, roomRef, isGroup, members, roomName, photoUrl);
			this.roomList.set(roomId, room);

			console.log(`Room ${roomId} loaded for scheduled message`);
		} catch (error) {
			console.error(`Error loading room ${roomId}:`, error);
			throw error;
		}
	}

	async scheduleNextRecurringMessage(scheduledMessage) {
		try {
			const { recurringPattern, scheduledTime } = scheduledMessage;
			let nextScheduledTime;

			switch (recurringPattern) {
				case 'daily':
					nextScheduledTime = new Date(scheduledTime.getTime() + 24 * 60 * 60 * 1000);
					break;
				case 'weekly':
					nextScheduledTime = new Date(scheduledTime.getTime() + 7 * 24 * 60 * 60 * 1000);
					break;
				case 'monthly':
					nextScheduledTime = new Date(scheduledTime);
					nextScheduledTime.setMonth(nextScheduledTime.getMonth() + 1);
					break;
				default:
					console.log(`Unknown recurring pattern: ${recurringPattern}`);
					return;
			}

			// Create a new scheduled message for the next occurrence
			const nextScheduledMessage = {
				...scheduledMessage,
				scheduledTime: nextScheduledTime,
				createdAt: new Date(),
				status: 'pending'
			};

			delete nextScheduledMessage.id; // Remove the old ID
			delete nextScheduledMessage.sentAt; // Remove sentAt if it exists

			await dbHelper.createScheduledMessage(nextScheduledMessage);
			console.log(`Next recurring message scheduled for ${nextScheduledTime}`);
		} catch (error) {
			console.error(`Error scheduling next recurring message:`, error);
		}
	}

	// Manual trigger for testing
	async triggerScheduledMessages() {
		console.log('Manually triggering scheduled message processing...');
		await this.processScheduledMessages();
	}
}

module.exports = SchedulerService;
