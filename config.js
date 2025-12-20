require('dotenv').config()

module.exports = {
	PORT: process.env.PORT,
	expiresIn: 60 * 60 * 24 * 60 * 1000, //60 days
	firebase: {
		storageBucketName: `${process.env.PROJECT_ID}.appspot.com`
	},
	serviceAccount: {
		type: process.env.TYPE,
		project_id: process.env.PROJECT_ID,
		private_key_id: process.env.PRIVATE_KEY_ID,
		private_key: `-----BEGIN PRIVATE KEY-----\n${process.env.PRIVATE_KEY}\n-----END PRIVATE KEY-----`,
		client_email: process.env.CLIENT_EMAIL,
		client_id: process.env.CLIENT_ID,
		auth_uri: process.env.AUTH_URI,
		token_uri: process.env.TOKEN_URI,
		auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
		client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
		universe_domain: process.env.UNIVERSE_DOMAIN
	},
	chatDocSize: 50,
	allowedOrigins: ['http://localhost:3000', 'chatify-a.vercel.app', 'http://localhost:8192', 'http://localhost:8081', 'exp://192.168.0.102:8081', 'http://192.168.0.102:8081'],
	zep: {
		apiKey: process.env.ZEP_API_KEY || ''
	},
	storageBucketCorsConfiguration: {
		"origin": this.allowedOrigins,
		"method": ["GET"],
		"maxAgeSeconds": 3600
	}
}

