export function removeAllWhitespace(str: string): string {
	if (str == null) return "";
	return str.replace(/\s+/g, "");
}

export function strip(str: string): string {
	if (str == null) return "";
	return str.trim();
}
