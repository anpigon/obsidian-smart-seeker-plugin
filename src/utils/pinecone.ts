import { Pinecone } from "@pinecone-database/pinecone";

export const createPineconeClient = (apiKey: string) => {
	return new Pinecone({ apiKey });
};
