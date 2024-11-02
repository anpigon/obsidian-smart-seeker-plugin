export const EMBEDDING_DIMENSION = 1536;
export const EMBEDDING_MODEL = "text-embedding-3-small";

export const PINECONE_CONFIG = {
	metric: "dotproduct",
	spec: {
		serverless: {
			cloud: "aws",
			region: "us-east-1",
		},
	},
} as const;
