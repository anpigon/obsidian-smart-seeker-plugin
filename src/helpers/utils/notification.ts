import { Notice } from "obsidian";

export const showError = (message: string, error?: unknown) => {
	console.error(message, error);
	new Notice(message);
};

export const showSuccess = (message: string) => {
	new Notice(message);
};
