import { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

interface TextRange {
	from: number;
	to: number;
}

export async function openNote(app: App, filePath: string) {
	return openNoteAndHighlightText(app, filePath);
}

export async function openNoteAndHighlightText(
	app: App,
	filePath: string,
	searchText?: string,
	range?: TextRange,
): Promise<void> {
	if (!filePath) {
		throw new Error("File path not found");
	}

	const targetFile = app.vault.getAbstractFileByPath(filePath);
	if (!(targetFile instanceof TFile)) {
		throw new Error(`File not found: ${filePath}`);
	}

	try {
		// 열려있는 모든 마크다운 뷰를 가져옵니다.
		const leaves = app?.workspace.getLeavesOfType("markdown") ?? [];

		let targetLeaf: WorkspaceLeaf | null = null;

		// 열려있는 뷰를 순회하면서 targetFile을 표시하는 뷰를 찾습니다.
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file === targetFile) {
				targetLeaf = leaf;
				break;
			}
		}

		if (targetLeaf) {
			app?.workspace.setActiveLeaf(targetLeaf);
		} else {
			targetLeaf = app.workspace.getLeaf(true);
			await targetLeaf?.openFile(targetFile);
		}

		if (!searchText || !range) {
			return;
		}

		const view = targetLeaf?.view;
		if (view?.getViewType() !== "markdown") return;

		const editor = (view as MarkdownView).editor;
		if (!editor) return;

		const normalizedSearchText = searchText
			?.toString()
			.replace(/^(?:\(cont'd\)\s*)?/, "") // Remove (cont'd) prefix if exists
			.split("\n")[0]
			.trim();

		const fileContent = editor.getValue();
		const lines = fileContent.split("\n");

		// Find the actual line where the text exists
		const foundLine =
			lines
				.slice(range.from)
				.findIndex((line) => line.includes(normalizedSearchText)) + range.from;

		if (foundLine > -1) {
			const offset = foundLine - range.from;
			const from = { line: foundLine, ch: 0 };
			const to = {
				line: range.to + offset,
				ch: lines[range.to + offset].length,
			};

			// Scroll to position and select text
			editor.setCursor(from);
			editor.setSelection(from, to);
			editor.scrollIntoView({ from, to: from }, true);
		}

		editor.focus();
	} catch (error) {
		console.error("Error opening file:", error);
		throw new Error("Failed to open file");
	}
}
