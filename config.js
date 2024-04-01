require('dotenv').config()

module.exports = {
	PORT: process.env.PORT,
	expiresIn: 60 * 60 * 24 * 60 * 1000, //60 days
	firebase: {},
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
}

