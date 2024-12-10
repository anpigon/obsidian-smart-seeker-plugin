import type { FrontMatterCache } from "obsidian";

export interface NoteMetadata extends FrontMatterCache {
	id: string;
	folderPaths: string[];
	filepath: string;
	filename: string;
	ctime: number;
	mtime: number;
	title: string;
	hash: string;
}
