// Add this type declaration at the top of the file or in a separate .d.ts file

// ref: https://publish.obsidian.md/omnisearch/Public+API+%26+URL+Scheme#Omnisearch+API
type OmniSearchMatchApi = {
	match: string;
	offset: number;
};

type OmniSearchResultNoteApi = {
	score: number;
	vault: string;
	path: string;
	basename: string;
	foundWords: string[];
	matches: OmniSearchMatchApi[];
	excerpt: string;
};

type OmnisearchApi = {
	// Returns a promise that will contain the same results as the Vault modal
	search: (query: string) => Promise<OmniSearchResultNoteApi[]>;
	// Refreshes the index
	refreshIndex: () => Promise<void>;
	// Register a callback that will be called when the indexing is done
	registerOnIndexed: (callback: () => void) => void;
	// Unregister a callback that was previously registered
	unregisterOnIndexed: (callback: () => void) => void;
};
declare global {
	interface Window {
		omnisearch?: OmnisearchApi;
	}
}

export { }; // This makes the file a module
