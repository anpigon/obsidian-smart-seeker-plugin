export const PLUGIN_APP_ID = "smart-seeker";

export const DEFAULT_EMBEDDING_DIMENSION = 1536;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const ZERO_VECTOR = new Array(DEFAULT_EMBEDDING_DIMENSION).fill(0);

export const PINECONE_CONFIG = {
	metric: "dotproduct",
	spec: {
		serverless: {
			cloud: "aws",
			region: "us-east-1",
		},
	},
} as const;

export const DEFAULT_MIN_TOKEN_COUNT = 200;
export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 200;

export const PORVIDERS = {
	OPENAI: "openai",
	GEMINI: "gemini",
} as const;

export const EMBEDDING_MODEL_OPTIONS = [
	{
		id: "text-embedding-3-small",
		name: "openai/text-embedding-3-small",
		provider: PORVIDERS.OPENAI,
		dimension: 1536,
	},
];
