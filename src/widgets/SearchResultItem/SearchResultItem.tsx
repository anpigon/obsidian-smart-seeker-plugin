import IconRightTriangle from "@/widgets/icons/IconRightTriangle";
import { useState } from "react";

interface SearchResultItemProps {
	id?: string;
	title: string;
	score: string;
	text: string;
	onTitleClick: (id?: string) => void;
	onMatchClick: (id?: string) => void;
}

const SearchResultItem = ({
	id,
	score,
	title,
	text,
	onMatchClick,
	onTitleClick,
}: SearchResultItemProps) => {
	const [isCollapsed, setIsCollapsed] = useState(true);

	const handleToggleCollapsed: React.MouseEventHandler<HTMLDivElement> = (
		event,
	) => {
		event.stopPropagation();
		setIsCollapsed(!isCollapsed);
	};

	const handleTitleClick = () => onTitleClick(id);

	const handleMatchClick = () => onMatchClick(id);

	return (
		<div className="tree-item search-result is-collapsed">
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: <explanation> */}
			<div
				className="tree-item-self search-result-file-title is-clickable"
				onClick={handleTitleClick}
			>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: <explanation> */}
				<div
					className={`tree-item-icon collapse-icon ${isCollapsed ? "is-collapsed" : ""}`}
					onClick={handleToggleCollapsed}
				>
					<IconRightTriangle />
				</div>
				<div className="tree-item-inner">{title}</div>
				<div className="tree-item-flair-outer">
					<span className="tree-item-flair">{score}</span>
				</div>
			</div>
			{!isCollapsed && (
				// biome-ignore lint/a11y/useKeyWithClickEvents: <explanation>
				<div className="search-result-file-matches" onClick={handleMatchClick}>
					<div className="search-result-file-match tappable">{text}</div>
				</div>
			)}
		</div>
	);
};

export default SearchResultItem;
