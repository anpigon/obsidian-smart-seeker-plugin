import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import obsidianFetchApi from "src/helpers/utils/obsidianFetchApi";

export const createPineconeClient = (apiKey: string) => {
	// return new Pinecone({
	// 	apiKey,
	// 	fetchApi: obsidianFetchApi,
	// });

	const pinecone = new PineconeClient({
		apiKey,
		fetchApi: obsidianFetchApi,
	});
	return pinecone;
};
