import { PLUGIN_APP_ID } from "src/constants";

export interface NoteHash {
	filepath: string;
	hash: string;
	timestamp: number;
}

export default class NoteHashStorage {
	private dbName = PLUGIN_APP_ID;
	private storeName = "hashes";
	private db: IDBDatabase | null = null;

	constructor() {
		this.initDB();
	}

	private async initDB(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, 1);

			request.onerror = () => {
				console.error("IndexedDB 열기 실패:", request.error);
				reject(request.error);
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					const store = db.createObjectStore(this.storeName, {
						keyPath: "filepath",
					});
					store.createIndex("timestamp", "timestamp", {
						unique: false,
					});
				}
			};
		});
	}

	private async getDBStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
		if (!this.db) {
			await this.initDB();
		}

		if (!this.db) {
			throw new Error("Failed to initialize IndexedDB");
		}

		const transaction = this.db.transaction([this.storeName], mode);
		return transaction.objectStore(this.storeName);
	}

	async saveHash(filepath: string, hash: string): Promise<void> {
		try {
			const store = await this.getDBStore("readwrite");

			return new Promise((resolve, reject) => {
				const noteHash: NoteHash = {
					filepath,
					hash,
					timestamp: Date.now(),
				};

				const request = store.put(noteHash);

				request.onerror = () => {
					console.error("해시 저장 실패:", request.error);
					reject(request.error);
				};

				request.onsuccess = () => {
					resolve();
				};
			});
		} catch (error) {
			console.error("트랜잭션 생성 실패:", error);
			throw error;
		}
	}

	async getHash(filepath: string): Promise<string | null> {
		try {
			const store = await this.getDBStore("readonly");

			return new Promise((resolve, reject) => {
				const request = store.get(filepath);

				request.onerror = () => {
					console.error("해시 조회 실패:", request.error);
					reject(request.error);
				};

				request.onsuccess = () => {
					const result = request.result as NoteHash;
					resolve(result ? result.hash : null);
				};
			});
		} catch (error) {
			console.error("트랜잭션 생성 실패:", error);
			throw error;
		}
	}

	async exists(filepath: string): Promise<boolean> {
		try {
			const store = await this.getDBStore("readonly");

			return new Promise((resolve, reject) => {
				const request = store.count(filepath);

				request.onerror = () => {
					console.error("존재 여부 확인 실패:", request.error);
					reject(request.error);
				};

				request.onsuccess = () => {
					resolve(request.result > 0);
				};
			});
		} catch (error) {
			console.error("트랜잭션 생성 실패:", error);
			throw error;
		}
	}

	async deleteHash(filepath: string): Promise<void> {
		try {
			const store = await this.getDBStore("readwrite");

			return new Promise((resolve, reject) => {
				const request = store.delete(filepath);

				request.onerror = () => {
					console.error("해시 삭제 실패:", request.error);
					reject(request.error);
				};

				request.onsuccess = () => {
					resolve();
				};
			});
		} catch (error) {
			console.error("트랜잭션 생성 실패:", error);
			throw error;
		}
	}
}
