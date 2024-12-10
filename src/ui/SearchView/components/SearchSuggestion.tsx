interface SearchSuggestionProps {
	style?: React.CSSProperties;
}

const SearchSuggestion = ({ style }: SearchSuggestionProps) => {
	const suggestions = [
		{
			type: "group",
			title: "검색 옵션",
			icon: (
				<div
					className="list-item-part search-suggest-icon clickable-icon"
					aria-label="더보기"
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						console.log("click");
						open("https://help.obsidian.md/Plugins/Search");
					}}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="svg-icon lucide-info"
					>
						<circle cx="12" cy="12" r="10" />
						<path d="M12 16v-4" />
						<path d="M12 8h.01" />
					</svg>
				</div>
			),
		},
		// {
		// 	title: "path:",
		// 	description: "파일 경로 일치",
		// },
		// {
		// 	title: "file:",
		// 	description: "파일 이름과 일치",
		// },
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

	return (
		<div className="suggestion-container mod-search-suggestion" style={style}>
			<div className="suggestion">
				{suggestions.map((suggestion, index) => (
					<div
						key={index}
						className={`suggestion-item mod-complex search-suggest-item${
							suggestion.type === "group" ? " mod-group" : ""
						}`}
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
};

export default SearchSuggestion;
