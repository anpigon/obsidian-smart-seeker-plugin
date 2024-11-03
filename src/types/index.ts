export interface NoteMetadata {
	filePath: string;
	ctime: number;
	mtime: number;
	title: string;
	[key: string]: unknown;
}
