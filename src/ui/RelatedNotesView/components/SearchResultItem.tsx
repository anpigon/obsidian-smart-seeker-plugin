import IconRightTriangle from "@/ui/icons/IconRightTriangle";
import { useState } from "react";

interface SearchResultItemProps {
	id?: string;
	filePath?: string;
	title: string;
	score: string;
	text: string;
	from?: number;
	to?: number;
	onTitleClick: (filePath?: string) => void;
	onMatchClick: (
		filePath?: string,
		text?: string,
		from?: number,
		to?: number,
	) => void;
}

const SearchResultItem = ({
	filePath,
	score,
	title,
	text,
	from,
	to,
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

	const handleTitleClick = () => onTitleClick(filePath);

	const handleMatchClick = () => onMatchClick(filePath, text, from, to);

	return (
		<div className="tree-item search-result is-collapsed">
			<div
				className="tree-item-self search-result-file-title is-clickable"
				onClick={handleTitleClick}
			>
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
				<div className="search-result-file-matches" onClick={handleMatchClick}>
					<div className="search-result-file-match tappable">{text}</div>
				</div>
			)}
		</div>
	);
};

export default SearchResultItem;
