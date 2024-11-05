import { Pinecone } from "@pinecone-database/pinecone";
import obsidianFetchApi from "src/helpers/utils/obsidianFetchApi";

export const createPineconeClient = (apiKey: string) => {
	return new Pinecone({
		apiKey,
		fetchApi: obsidianFetchApi,
	});
};
