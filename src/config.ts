require('dotenv').config()

interface ServiceAccount {
	type: string | undefined;
	project_id: string | undefined;
	private_key_id: string | undefined;
	private_key: string | undefined;
	client_email: string | undefined;
	client_id: string | undefined;
	auth_uri: string | undefined;
	token_uri: string | undefined;
	auth_provider_x509_cert_url: string | undefined;
	client_x509_cert_url: string | undefined;
	universe_domain: string | undefined;
}

interface Config {
	PORT: string | undefined;
	expiresIn: number;
	firebase: {
		storageBucketName: string;
	};
	serviceAccount: ServiceAccount;
	chatDocSize: number;
	allowedOrigins: string[];
	storageBucketCorsConfiguration: {
		origin: string[];
		method: string[];
		maxAgeSeconds: number;
	};
}

const config : Config = {
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
	storageBucketCorsConfiguration: {
		"origin": ['http://localhost:3000', 'chatify-a.vercel.app', 'http://localhost:8192', 'http://localhost:8081', 'exp://192.168.0.102:8081', 'http://192.168.0.102:8081'],
		"method": ["GET"],
		"maxAgeSeconds": 3600
	}
}


module.exports = config
export {};
