import IconRightTriangle from "@/ui/icons/IconRightTriangle";
import { useState } from "react";

interface SearchResultItemProps {
	filePath?: string;
	title: string;
	score: string;
	text: string;
}

const SearchResultItem = ({
	filePath,
	score,
	title,
	text,
}: SearchResultItemProps) => {
	const [isCollapsed, setIsCollapsed] = useState(true);

	const handleToggleCollapsed = () => {
		setIsCollapsed(!isCollapsed);
	};

	return (
		<div className="tree-item search-result is-collapsed">
			<div className="tree-item-self search-result-file-title is-clickable">
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
				<div className="search-result-file-matches">
					<div className="search-result-file-match tappable">{text}</div>
				</div>
			)}
		</div>
	);
};

export default SearchResultItem;
