import { AppContext, PluginContext, SettingsContext } from "@/shared/context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { App } from "obsidian";
import type SmartSeekerPlugin from "../main";

interface AppProviderProps {
	app: App;
	plugin: SmartSeekerPlugin;
	children: React.ReactNode;
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			refetchOnWindowFocus: false,
		},
	},
});

const AppProvider = ({ app, plugin, children }: AppProviderProps) => {
	return (
		<QueryClientProvider client={queryClient}>
			<AppContext.Provider value={app}>
				<PluginContext.Provider value={plugin}>
					<SettingsContext.Provider value={plugin.settings}>
						{children}
					</SettingsContext.Provider>
				</PluginContext.Provider>
			</AppContext.Provider>
		</QueryClientProvider>
	);
};

export default AppProvider;
