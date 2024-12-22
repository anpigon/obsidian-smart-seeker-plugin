# Obsidian Smart Seeker Plugin

This plugin enhances your Obsidian experience by integrating with PineconeDB and OpenAI to provide advanced note management and search capabilities.

## Features

-   **Note Management**: Automatically detects note creation, modification, and deletion events in Obsidian and updates PineconeDB accordingly.
-   **Search Functionality**: Provides a modal to search notes using PineconeDB, leveraging OpenAI's embedding model for vectorization.
-   **Settings**: Includes a settings tab for configuring PineconeDB and OpenAI API keys.

## Installation

1. Clone this repository.
2. Ensure your NodeJS version is at least v16 (`node --version`).
3. Run `pnpm install` to install dependencies.
4. Use `pnpm run dev` to start the plugin in development mode.

## Project Structure

The project follows a simplified feature-based architecture:

```
src/
├── app/ # Plugin initialization and settings
│	├── main.ts
│	└── settings/
├── features/ # Core plugin features
│	├── noteSearch/ # Note search functionality
│	└── relatedNotes/ # Related notes feature
├── widgets/ # Reusable UI components
│	├── SearchResultItem/
│	└── icons/
└── shared/ # Shared utilities and types
	├── api/ # OpenAI and Pinecone integration
	├── types/
	├── utils/
	├── errors/ # Common reusable error handling
	└── services/ # Common services
		├── CacheManager.ts
		├── OpenAIManager.ts
		└── PineconeManager.ts
```

## Configuration

-   **PineconeDB**: Set your PineconeDB API key and select an index in the settings tab.
-   **OpenAI**: Set your OpenAI API key in the settings tab.

## Usage

-   **Search Notes**: Use the "Search notes" command to open the search modal and find notes based on their content.
-   **Note Events**: The plugin will automatically handle note creation, modification, and deletion, updating PineconeDB as needed.

## Releasing New Versions

-   Update `manifest.json` and `versions.json` with the new version details.
-   Create a new GitHub release and upload the necessary files.

## Community Plugin List

-   Follow the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) to add your plugin to the community list.

## Improve Code Quality

-   Use [ESLint](https://eslint.org/) to analyze and improve your code quality.

## Funding

You can include funding URLs in your `manifest.json` to allow users to support your work.

## API Documentation

For more details, see the [Obsidian API documentation](https://github.com/obsidianmd/obsidian-api).
