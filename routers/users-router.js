const Router = require('express').Router;
const dbHelper = require('../helpers/db-helper');

const router = new Router();

router.get('/users/search-user', async (req, res) => {
	const searchUser = req.query.searchuser;

	if(!searchUser) {
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


module.exports = router