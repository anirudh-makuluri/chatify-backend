const cors = require('cors');
const Router = require('express').Router;
const jwt = require('jsonwebtoken');
const config = require('../config');
const dbHelper = require('../helpers/db-helper');

const router = new Router();

const corsOptions = {
	origin: config.allowedOrigins,
	credentials: true
};

router.options('/session/', cors(corsOptions))

router.get('/', (req, res) => {
	console.log("Pinged :)");
	res.send("Hello :)")
})

router.post('/session', (req, res) => {
	const idToken = req.body.idToken.toString();

	config.firebase.admin.auth().verifyIdToken(idToken).then(async (decodedToken) => {
		console.log("Decoded token: ", decodedToken);
		const response = await dbHelper.createUser(decodedToken)
		console.log(response)

		if(response.error) throw response.error

		const expiresIn = 60 * 60 * 24 * 5 * 1000; //5 days
		config.firebase.admin.auth().createSessionCookie(idToken, { expiresIn })
			.then(sessionCookie => {
				const options = { maxAge: expiresIn, httpOnly: true, secure: false, sameSite: 'lax' }
				if(config.PORT != 5000) {
					options.secure = true;
					options.sameSite = 'none'
				}
				res.cookie('session', sessionCookie, options);
				res.end(JSON.stringify({ status: 'success' }))
			},
			(error) => {
				res.status(401).send('UNAUTHORIZED REQUEST!');
			})
	}).catch(error => {
		console.log(error);
		res.status(401).send({ error })
	})
})

router.get('/session', (req, res) => {
	if (corsOptions.origin.includes(req.headers.origin)) {
		res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
	}
	res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
	res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	res.header('Access-Control-Allow-Credentials', true);

	if(req.cookies.session) {
		config.firebase.admin.auth().verifySessionCookie(req.cookies.session, true)
		.then(async (decodedClaims) => {
			const uid = decodedClaims.uid;

			const response = await dbHelper.getAuthUserData(uid);

			res.send(response);
		}).catch((error) => {
			console.log(error)
			res.clearCookie('session');
			res.status(401).send({ error: 'Session invalid, please login again' });
		});
	}else {
		res.status(401).send({ error: 'No session found, please login' });
	}
})

router.delete('/session', (req, res) => {
	res.clearCookie('session');
	res.send({ success: 'Successfully deleted session' });
})


module.exports = router