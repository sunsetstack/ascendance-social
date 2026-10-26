import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

export const POST_CHARACTER_LIMIT = 600;
export const COMMENT_CHARACTER_LIMIT = 500;

export default function CharacterCounter({ value, limit }: { value: string; limit: number }): React.ReactElement {
  const { t } = useTranslation();
  const count = value.length;
  const ratio = count / limit;
  const color = limit - count < 30 ? "#f42146" : ratio < 1 / 3 ? "#e9eef5" : ratio < 2 / 3 ? "#38bdf8" : "#3b82f6";
  return <Box sx={{ ml: "auto", width: 112, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
    <Typography variant="caption" sx={{ color, fontVariantNumeric: "tabular-nums" }}>{count} / {limit}</Typography>
    <Box role="progressbar" aria-label={t("composer.characters")} aria-valuemin={0} aria-valuemax={limit}
      aria-valuenow={Math.min(count, limit)} aria-valuetext={t("composer.remaining", { count: limit - count })}
      sx={{ width: "100%", height: 4, borderRadius: 999, bgcolor: "divider", overflow: "hidden" }}>
      <Box sx={{ height: "100%", width: `${Math.min(100, ratio * 100)}%`, bgcolor: color, borderRadius: "inherit",
        transition: "width 160ms ease, background-color 160ms ease", "@media (prefers-reduced-motion: reduce)": { transition: "none" } }} />
    </Box>
  </Box>;
}
