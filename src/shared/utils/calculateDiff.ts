export default function calculateDiff(newContent: string, oldContent: string) {
	let changes = 0;
	const maxLength = Math.max(newContent.length, oldContent.length);

	for (let i = 0; i < maxLength; i++) {
		if (newContent[i] !== oldContent[i]) {
			changes++;
		}
	}

	return changes;
}
