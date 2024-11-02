export const EMBEDDING_DIMENSION = 1536;

export const PINECONE_CONFIG = {
	metric: "dotproduct",
	spec: {
		serverless: {
			cloud: "aws",
			region: "us-east-1",
		},
	},
} as const;
