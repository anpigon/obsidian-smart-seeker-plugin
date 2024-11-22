import IconRightTriangle from "@/ui/icons/IconRightTriangle";
import { useState } from "react";

interface SearchResultItemProps {
	filePath?: string;
	title: string;
	score: string;
	text: string;
	onClick: (filePath: string) => void;
}

const SearchResultItem = ({
	filePath,
	score,
	title,
	text,
	onClick,
}: SearchResultItemProps) => {
	const [isCollapsed, setIsCollapsed] = useState(true);

	const handleToggleCollapsed: React.MouseEventHandler<HTMLDivElement> = (
		event,
	) => {
		event.stopPropagation();
		setIsCollapsed(!isCollapsed);
	};

	const handleClick = () => {
		if (filePath) {
			onClick(filePath);
		}
	};

	return (
		<div className="tree-item search-result is-collapsed">
			<div
				className="tree-item-self search-result-file-title is-clickable"
				onClick={handleClick}
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
				<div className="search-result-file-matches">
					<div className="search-result-file-match tappable">{text}</div>
				</div>
			)}
		</div>
	);
};

export default SearchResultItem;
