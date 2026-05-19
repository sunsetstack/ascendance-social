import React, { useState, useRef, useMemo, useCallback } from "react";
import {
	Box,
	InputBase,
	Paper,
	List,
	ListItemButton,
	ListItemAvatar,
	ListItemText,
	Avatar,
	ClickAwayListener,
	Popper,
	useTheme,
	alpha,
	SxProps,
	Theme,
} from "@mui/material";
import { getCaretCoordinates } from "../utils/caretCoordinates";
import { useHandleSuggestions } from "../hooks/user/useHandleSuggestions";
import { HandleSuggestion, HandleSuggestionContext } from "../types";

interface MentionInputProps {
	value: string;
	onChange: (value: string) => void;
	context?: HandleSuggestionContext;
	placeholder?: string;
	disabled?: boolean;
	multiline?: boolean;
	minRows?: number;
	maxRows?: number;
	onKeyDown?: (e: React.KeyboardEvent) => void;
	onFocus?: (e: React.FocusEvent) => void;
	onBlur?: (e: React.FocusEvent) => void;
	sx?: SxProps<Theme>;
	autoFocus?: boolean;
}

const MentionInput: React.FC<MentionInputProps> = ({
	value,
	onChange,
	context = "mention",
	placeholder,
	disabled,
	multiline,
	minRows = 1,
	maxRows,
	onKeyDown,
	onFocus,
	onBlur,
	sx,
	autoFocus,
}) => {
	const theme = useTheme();
	const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
	const backdropRef = useRef<HTMLDivElement>(null);
	const [caretCoords, setCaretCoords] = useState<{ top: number; left: number } | null>(null);
	const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number; end: number } | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);

	// Suggestion fetching
	const suggestionsQuery = useHandleSuggestions(mentionQuery?.query || "", context, 5, Boolean(mentionQuery));
	const suggestions = suggestionsQuery.data?.users || [];
	const showSuggestions = Boolean(mentionQuery && suggestions.length > 0);

	const handleScroll = (e: React.UIEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		if (backdropRef.current) {
			backdropRef.current.scrollTop = e.currentTarget.scrollTop;
			backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
		}
	};

	// Render backdrop with mentions highlighted, regular text in normal color
	const renderBackdrop = useCallback(() => {
		if (!value) return null;

		const parts: React.ReactNode[] = [];
		const regex = /(@[a-zA-Z0-9._]+)/g;
		let lastIndex = 0;
		let match;

		while ((match = regex.exec(value)) !== null) {
			// Regular text before mention
			if (match.index > lastIndex) {
				parts.push(<span key={`text-${lastIndex}`}>{value.substring(lastIndex, match.index)}</span>);
			}
			// Mention - colored blue
			parts.push(
				<span key={`mention-${match.index}`} style={{ color: theme.palette.primary.main }}>
					{match[0]}
				</span>,
			);
			lastIndex = regex.lastIndex;
		}
		// Remaining regular text
		if (lastIndex < value.length) {
			parts.push(<span key={`text-${lastIndex}`}>{value.substring(lastIndex)}</span>);
		}

		return parts;
	}, [value, theme.palette.primary.main]);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		const newValue = e.target.value;
		onChange(newValue);

		const selectionStart = e.target.selectionStart;
		if (selectionStart !== null) {
			checkMentionTrigger(newValue, selectionStart);
		}
	};

	const handleSelect = (e: React.SyntheticEvent<HTMLDivElement>) => {
		const target = e.target as HTMLInputElement | HTMLTextAreaElement;
		if (mentionQuery) {
			checkMentionTrigger(target.value, target.selectionStart || 0);
		}
	};

	const checkMentionTrigger = (text: string, caretPos: number) => {
		const sub = text.substring(0, caretPos);
		const match = sub.match(/(^|\s)(@[a-zA-Z0-9._]*)$/);

		if (match) {
			const query = match[2].substring(1);
			const start = (match.index ?? 0) + match[1].length;
			setMentionQuery({ query, start, end: caretPos });
			setSelectedIndex(0);

			if (inputRef.current) {
				const coords = getCaretCoordinates(inputRef.current, start);
				setCaretCoords({ top: coords.top, left: coords.left });
			}
		} else {
			setMentionQuery(null);
			setCaretCoords(null);
			setSelectedIndex(0);
		}
	};

	const selectSuggestion = useCallback(
		(suggestion: HandleSuggestion) => {
			if (!mentionQuery) return;

			const before = value.substring(0, mentionQuery.start);
			const after = value.substring(mentionQuery.end);
			const inserted = `@${suggestion.handle} `;
			const newValue = before + inserted + after;

			onChange(newValue);
			setMentionQuery(null);
			setCaretCoords(null);
			setSelectedIndex(0);

			requestAnimationFrame(() => {
				if (inputRef.current) {
					inputRef.current.focus();
					const newCursorPos = before.length + inserted.length;
					inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
				}
			});
		},
		[mentionQuery, value, onChange],
	);

	const handleInputKeyDown = (e: React.KeyboardEvent) => {
		if (showSuggestions) {
			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					setSelectedIndex((prev) => (prev + 1) % suggestions.length);
					return;
				case "ArrowUp":
					e.preventDefault();
					setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
					return;
				case "Enter":
				case "Tab":
					if (suggestions[selectedIndex]) {
						e.preventDefault();
						selectSuggestion(suggestions[selectedIndex]);
						return;
					}
					break;
				case "Escape":
					e.preventDefault();
					setMentionQuery(null);
					setCaretCoords(null);
					return;
			}
		}
		if (onKeyDown) onKeyDown(e);
	};

	const virtualAnchor = useMemo(() => {
		if (!caretCoords || !inputRef.current) return null;

		const rect = inputRef.current.getBoundingClientRect();
		const lineHeight = parseInt(window.getComputedStyle(inputRef.current).lineHeight) || 24;

		return {
			getBoundingClientRect: () =>
				({
					top: rect.top + caretCoords.top,
					left: rect.left + caretCoords.left,
					right: rect.left + caretCoords.left,
					bottom: rect.top + caretCoords.top + lineHeight,
					width: 0,
					height: lineHeight,
					x: rect.left + caretCoords.left,
					y: rect.top + caretCoords.top,
					toJSON: () => ({}),
				}) as DOMRect,
		};
	}, [caretCoords]);

	return (
		<Box sx={{ position: "relative" }}>
			<Box
				sx={[
					{
						position: "relative",
						width: "100%",
						fontFamily: theme.typography.fontFamily,
						fontSize: theme.typography.body1.fontSize,
						lineHeight: theme.typography.body1.lineHeight,
						borderRadius: 1,
						border: "1px solid",
						borderColor: "divider",
						backgroundColor: alpha(theme.palette.common.white, 0.05),
						"&:hover": {
							backgroundColor: alpha(theme.palette.common.white, 0.08),
							borderColor: "text.secondary",
						},
						"&:focus-within": {
							borderColor: "primary.main",
							backgroundColor: "transparent",
						},
					},
					...(Array.isArray(sx) ? sx : [sx ?? {}]),
				]}
			>
				{/* Backdrop for mention highlighting only */}
				<Box
					ref={backdropRef}
					aria-hidden="true"
					component="div"
					sx={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						p: "8.5px 14px",
						whiteSpace: multiline ? "pre-wrap" : "nowrap",
						wordWrap: multiline ? "break-word" : "normal",
						overflow: "hidden",
						pointerEvents: "none",
						color: theme.palette.text.primary,
						fontFamily: "inherit",
						fontSize: "inherit",
						lineHeight: "inherit",
						letterSpacing: "inherit",
						wordBreak: multiline ? "break-word" : "normal",
					}}
				>
					{renderBackdrop()}
				</Box>

				{/* The actual input - text is transparent, backdrop shows colored text */}
				<InputBase
					inputRef={inputRef}
					value={value}
					onChange={handleChange}
					onSelect={handleSelect}
					onKeyDown={handleInputKeyDown}
					onFocus={onFocus}
					onBlur={onBlur}
					placeholder={placeholder}
					disabled={disabled}
					multiline={multiline}
					minRows={minRows}
					maxRows={maxRows}
					autoFocus={autoFocus}
					fullWidth
					inputProps={{
						onScroll: handleScroll,
						role: "combobox",
						"aria-autocomplete": "list",
						"aria-expanded": showSuggestions,
						"aria-controls": showSuggestions ? "mention-suggestion-listbox" : undefined,
						"aria-activedescendant": showSuggestions && suggestions[selectedIndex]
							? `mention-option-${suggestions[selectedIndex].publicId}`
							: undefined,
					}}
					sx={{
						fontFamily: "inherit",
						fontSize: "inherit",
						lineHeight: "inherit",
						"& .MuiInputBase-input": {
							p: "8.5px 14px",
							color: "transparent",
							caretColor: theme.palette.text.primary,
							whiteSpace: multiline ? "pre-wrap" : "nowrap",
							wordWrap: multiline ? "break-word" : "normal",
							wordBreak: multiline ? "break-word" : "normal",
							"&::selection": {
								backgroundColor: theme.palette.primary.main,
								color: theme.palette.primary.contrastText,
								WebkitTextFillColor: theme.palette.primary.contrastText,
							},
							"&::placeholder": {
								color: theme.palette.text.secondary,
								opacity: 1,
								WebkitTextFillColor: theme.palette.text.secondary,
							},
						},
					}}
				/>
			</Box>

			<Popper
				open={showSuggestions}
				anchorEl={virtualAnchor}
				placement="bottom-start"
				modifiers={[
					{
						name: "offset",
						options: {
							offset: [0, 4],
						},
					},
					{
						name: "preventOverflow",
						options: {
							padding: 8,
						},
					},
					{
						name: "flip",
						options: {
							fallbackPlacements: ["top-start"],
						},
					},
				]}
				sx={{ zIndex: 1300 }}
			>
				<ClickAwayListener onClickAway={() => setMentionQuery(null)}>
					<Paper
						elevation={3}
						sx={{
							width: { xs: "calc(100vw - 32px)", sm: 240 },
							maxWidth: 280,
							maxHeight: 200,
							overflowY: "auto",
							borderRadius: 1.5,
						}}
						id="mention-suggestion-listbox" role="listbox"
					>
						<List dense disablePadding>
							{suggestions.map((user, index) => (
								<ListItemButton
									id={`mention-option-${user.publicId}`}
									key={user.publicId}
									onClick={() => selectSuggestion(user)}
									selected={index === selectedIndex}
									sx={{
										py: 1,
										px: 1.5,
										"&.Mui-selected": {
											backgroundColor: alpha(theme.palette.primary.main, 0.12),
										},
										"&.Mui-selected:hover": {
											backgroundColor: alpha(theme.palette.primary.main, 0.18),
										},
									}}
									role="option"
									aria-selected={index === selectedIndex}
								>
									<ListItemAvatar sx={{ minWidth: 40 }}>
										<Avatar
											src={user.avatar?.startsWith("http") ? user.avatar : `/api${user.avatar}`}
											alt={user.username}
											sx={{ width: 32, height: 32 }}
										/>
									</ListItemAvatar>
									<ListItemText
										primary={user.username}
										secondary={`@${user.handle}`}
										primaryTypographyProps={{
											variant: "body2",
											fontWeight: 500,
											noWrap: true,
											sx: { fontSize: "0.875rem" },
										}}
										secondaryTypographyProps={{
											variant: "caption",
											noWrap: true,
											sx: { fontSize: "0.75rem" },
										}}
									/>
								</ListItemButton>
							))}
						</List>
					</Paper>
				</ClickAwayListener>
			</Popper>
		</Box>
	);
};

export default MentionInput;
