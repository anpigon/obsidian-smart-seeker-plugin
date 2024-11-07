import { getEncoding } from "js-tiktoken";

export function splitContentIntoChunks(content: string): string[] {
	const maxTokens = 8000; // 최대 토큰 수 설정
	const enc = getEncoding("cl100k_base");
	const tokens = enc.encode(content);

	const chunks: string[] = [];
	let currentChunk: number[] = [];

	for (let i = 0; i < tokens.length; i++) {
		currentChunk.push(tokens[i]);

		if (currentChunk.length >= maxTokens || i === tokens.length - 1) {
			chunks.push(enc.decode(currentChunk));
			currentChunk = [];
		}
	}

	return chunks;
}
