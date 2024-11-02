import { requestUrl } from "obsidian";

const obsidianFetchApi = async (
	input: RequestInfo | URL,
	init?: RequestInit
) => {
	try {
		const response = await requestUrl({
			url: input.toString(),
			method: init?.method || "GET",
			headers: init?.headers as Record<string, string>,
			body: init?.body?.toString(),
		});

		return new Response(response.text, {
			status: response.status,
			headers: new Headers(response.headers),
		});
	} catch (error) {
		console.error("Pinecone API request failed:", error);
		throw error;
	}
};

export default obsidianFetchApi;
