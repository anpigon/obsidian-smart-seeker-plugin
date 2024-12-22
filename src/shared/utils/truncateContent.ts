import calculateTokenCount from "./calculateTokenCount";

const truncateContent = (
	content: string | undefined,
	maxTokens = 8192,
): string => {
	if (!content) return "";
	let truncatedContent = content.substring(0, maxTokens * 1.2);
	while (
		calculateTokenCount(truncatedContent) > maxTokens &&
		truncatedContent.length > 500
	) {
		truncatedContent = truncatedContent.substring(
			0,
			truncatedContent.length - 500,
		);
	}
	return truncatedContent;
};

export default truncateContent;
