import { getEncoding } from "js-tiktoken";

export default function calculateTokenCount(text: string): number {
	const enc = getEncoding("cl100k_base");
	return enc.encode(text).length;
}
