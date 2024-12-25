import IconInfo from "@/widgets/icons/IconInfo";
import { forwardRef } from "react";

interface SearchSuggestionProps {
	style?: React.CSSProperties;
	onSuggestionClick?: (suggestion: string) => void;
	isOpen?: boolean;
	onClose?: () => void;
}

const SearchSuggestion = forwardRef<HTMLDivElement, SearchSuggestionProps>(
	({ style, onSuggestionClick, isOpen, onClose }, ref) => {
		const suggestions = [
			{
				type: "group",
				title: "검색 옵션",
				icon: (
					<button
						type="button"
						className="list-item-part search-suggest-icon clickable-icon"
						aria-label="더보기"
						onClick={(e) => {
							open("https://help.obsidian.md/Plugins/Search");
						}}
					>
						<IconInfo />
					</button>
				),
			},
			{
				title: "path:",
				description: "파일 경로 일치",
			},
			{
				title: "file:",
				description: "파일 이름과 일치",
			},
			{
				title: "tag:",
				description: "태그 검색",
			},
			// {
			// 	title: "line:",
			// 	description: "동일한 행에서 키워드 검색",
			// },
			// {
			// 	title: "section:",
			// 	description: "동일한 제목으로 키워드 검색",
			// },
			// {
			// 	title: "[property]",
			// 	description: "match property",
			// },
		];

		const handleSuggestionClick = (suggestion: string) => {
			console.debug("suggestion", suggestion);
			onSuggestionClick?.(suggestion);
			onClose?.();
		};

		return (
			<div
				ref={ref}
				className="suggestion-container mod-search-suggestion"
				style={{ ...style, display: isOpen ? "block" : "none" }}
				onClick={(e) => {
					if (e.target === e.currentTarget) {
						onClose?.();
					}
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						if (e.target === e.currentTarget) {
							onClose?.();
						}
					}
				}}
			>
				<div className="suggestion">
					{suggestions.map((suggestion, index) => (
						<div
							key={suggestion.title}
							className={`suggestion-item mod-complex search-suggest-item${
								suggestion.type === "group" ? " mod-group" : ""
							}`}
							tabIndex={0}
							onClick={handleSuggestionClick.bind(null, suggestion.title)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									handleSuggestionClick(suggestion.title);
								}
							}}
						>
							<div className="suggestion-content">
								<div
									className={`suggestion-title${
										suggestion.type === "group"
											? " list-item-part mod-extended"
											: ""
									}`}
								>
									<span>{suggestion.title}</span>
									{suggestion.description && (
										<span className="search-suggest-info-text">
											{suggestion.description}
										</span>
									)}
								</div>
							</div>
							{suggestion.icon && (
								<div className="suggestion-aux">{suggestion.icon}</div>
							)}
						</div>
					))}
				</div>
			</div>
		);
	},
);

export default SearchSuggestion;
