import { useEffect, useState } from "react";
import { Alert, Box, Button } from "@mui/material";
import { useTranslation } from "react-i18next";

interface Props { file: File | null; onChange: (file: File | null) => void; disabled?: boolean }

export default function ImageAttachmentInput({ file, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!file) { setPreview(undefined); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <Box sx={{ mt: 1 }}>
    <Button component="label" disabled={disabled} size="small">
      {t("attachments.add")}
      <input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => {
        const next = event.target.files?.[0];
        if (next) {
          const valid = ["image/jpeg", "image/png", "image/webp"].includes(next.type) && next.size <= 10 * 1024 * 1024;
          setError(!valid);
          if (valid) onChange(next);
          else onChange(null);
        }
        event.target.value = "";
      }} />
    </Button>
    {file && <Button size="small" disabled={disabled} onClick={() => { onChange(null); setError(false); }}>{t("attachments.remove")}</Button>}
    {error && <Alert severity="error">{t("attachments.invalid")}</Alert>}
    {preview && <Box component="img" src={preview} alt={t("attachments.preview")} sx={{ display: "block", maxWidth: "100%", maxHeight: 240, borderRadius: 2, mt: 1 }} />}
  </Box>;
}
