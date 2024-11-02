import { Pinecone } from "@pinecone-database/pinecone";
import obsidianFetchApi from "./obsidianFetchApi";

export const createPineconeClient = (apiKey: string) => {
	return new Pinecone({
		apiKey,
		fetchApi: obsidianFetchApi,
	});
};
