export const PLUGIN_APP_ID = "smart-seeker";

export const DEFAULT_EMBEDDING_DIMENSION = 1536;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export const PINECONE_CONFIG = {
	metric: "dotproduct",
	spec: {
		serverless: {
			cloud: "aws",
			region: "us-east-1",
		},
	},
} as const;
