// Add this type declaration at the top of the file or in a separate .d.ts file

interface OmniSearchMatch {
	match: string;
	offset: number;
}

interface OmniSearchResult {
	score: number;
	vault: string;
	path: string;
	basename: string;
	foundWords: string[];
	matches: OmniSearchMatch[];
	excerpt: string;
}

export {}; // This makes the file a module

declare global {
	interface Window {
		omnisearch?: {
			search?: (query: string) => Promise<OmniSearchResult[]>;
		};
	}
}
