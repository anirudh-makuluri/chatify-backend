const cors = require('cors');
const Router = require('express').Router;
const jwt = require('jsonwebtoken');
const config = require('../config');
const dbHelper = require('../helpers/db-helper');
const logger = require('../logger');
const utils = require('../utils');

const router = new Router();

const corsOptions = {
	origin: config.allowedOrigins,
	credentials: true
};

router.options('/session/', cors(corsOptions))

router.get('/', (req, res) => {
	logger.info("Pinged :)");
	res.json({ message: "Hello :)" });
})

router.post('/session', (req, res) => {
	const idToken = req.body.idToken.toString();

	config.firebase.admin.auth().verifyIdToken(idToken).then(async (decodedToken) => {
		logger.info("Decoded token received");
		const response = await dbHelper.createUser(decodedToken)
		logger.debug("User creation response received");

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
				res.json({ status: 'success' });
			},
			(error) => {
				logger.error('Failed to create session cookie:', error);
				res.status(401).json({ error: 'UNAUTHORIZED REQUEST!' });
			})
	}).catch(error => {
		logger.error('Session creation error:', error);
		const sanitizedError = utils.sanitizeError(error);
		res.status(401).json({ error: sanitizedError });
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

			res.json(response);
		}).catch((error) => {
			logger.error('Session verification error:', error);
			res.clearCookie('session');
			res.status(401).json({ error: 'Session invalid, please login again' });
		});
	}else {
		res.status(401).json({ error: 'No session found, please login' });
	}
})

router.delete('/session', (req, res) => {
	res.clearCookie('session');
	res.json({ success: 'Successfully deleted session' });
})


module.exports = router