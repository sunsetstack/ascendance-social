import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Box, IconButton, TextField } from "@mui/material";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/context/useAuth";
import { buildAvatarUrl } from "../../lib/media";
import AppBrand from "../layout/AppBrand";

const HEADER_HEIGHT = 80;
interface MobileHeaderProps { onMenuClick: () => void }

export default function MobileHeader({ onMenuClick }: MobileHeaderProps): React.ReactElement {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { user } = useAuth();
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const search = (event: React.FormEvent): void => {
		event.preventDefault();
		if (!query.trim()) return;
		navigate(`/results?q=${encodeURIComponent(query.trim())}`);
		setSearchOpen(false);
		setQuery("");
	};
	return (
		<Box component="header" sx={{ position: "sticky", top: 0, zIndex: 1000, minHeight: HEADER_HEIGHT, px: { xs: 2, sm: 3 },
			pt: "env(safe-area-inset-top)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1,
			bgcolor: "background.default", borderBottom: 1, borderColor: "divider" }}>
			{searchOpen ? <Box component="form" onSubmit={search} sx={{ flex: 1, minWidth: 0 }}>
				<TextField autoFocus fullWidth size="small" value={query} onChange={(event) => setQuery(event.target.value)}
					placeholder={t("nav.search_placeholder")} inputProps={{ "aria-label": t("timeline.search") }} />
			</Box> : <AppBrand onMenuClick={onMenuClick} />}
			<Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
				<IconButton aria-label={searchOpen ? t("timeline.close_search") : t("timeline.search")} onClick={() => setSearchOpen(!searchOpen)} sx={{ width: 40, height: 44 }}>
					{searchOpen ? <X size={21} /> : <Search size={21} />}
				</IconButton>
				{user && !searchOpen && <IconButton aria-label={t("nav.profile")} onClick={() => navigate(`/profile/${user.handle}`)} sx={{ p: 0.5 }}>
					<Avatar src={buildAvatarUrl(user.avatar, 32)} sx={{ width: 30, height: 30 }}>{user.username?.charAt(0)}</Avatar>
				</IconButton>}
			</Box>
		</Box>
	);
}
export { HEADER_HEIGHT };

