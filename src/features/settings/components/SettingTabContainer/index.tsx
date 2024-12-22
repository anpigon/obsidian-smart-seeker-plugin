/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { usePlugin, useSettings } from "@/shared/hooks";
import { SettingItem } from "@/widgets/SettingItem";
import { useCallback } from "react";

const SettingTab: React.FC = () => {
	const plugin = usePlugin();
	const settings = useSettings();

	const createApiKeyDescription = useCallback(
		(description: string, link: string) => {
			return (
				<>
					{description}
					<br />키 발급 바로가기: <a href={link}>{link}</a>
				</>
			);
		},
		[],
	);

	return (
		<>
			<SettingItem
				name="OpenAI API 키"
				description={createApiKeyDescription(
					"OpenAI API 키를 입력하세요.",
					"https://platform.openai.com/api-keys",
				)}
			>
				<input
					type="password"
					spellCheck={false}
					placeholder="sk-..."
					onChange={async (e) => {
						settings.openAIApiKey = e.target.value;
						await plugin.saveSettings();
					}}
				/>
			</SettingItem>
		</>
	);
};

export default SettingTab;
