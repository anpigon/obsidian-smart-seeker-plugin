import obsidianFetchApi from "@/shared/api/obsidian/obsidianFetchApi";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";

export const createPineconeClient = (apiKey: string) => {
	return new PineconeClient({
		apiKey,
		fetchApi: obsidianFetchApi,
	});
};
