import { useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useRepostPost } from "../hooks/posts/usePosts";
import ImageAttachmentInput from "./ImageAttachmentInput";

interface Props { open: boolean; postPublicId: string; onClose: () => void }

export default function QuotePostDialog({ open, postPublicId, onClose }: Props) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const mutation = useRepostPost();
  const submit = (): void => {
    if (!body.trim() && !image) return;
    mutation.mutate({ postPublicId, body: body.trim(), image: image ?? undefined }, { onSuccess: () => {
      setBody(""); setImage(null); onClose();
    } });
  };
  return <Dialog open={open} onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>{t("attachments.quote")}</DialogTitle>
    <DialogContent>
      <TextField autoFocus fullWidth multiline minRows={2} value={body} disabled={mutation.isPending}
        label={t("attachments.quote_text")} inputProps={{ maxLength: 300 }} onChange={(event) => setBody(event.target.value)} sx={{ mt: 1 }} />
      <ImageAttachmentInput file={image} onChange={setImage} disabled={mutation.isPending} />
      {mutation.isError && <Alert severity="error">{t("post.repost_failed")}</Alert>}
    </DialogContent>
    <DialogActions>
      <Button disabled={mutation.isPending} onClick={onClose}>{t("attachments.cancel")}</Button>
      <Button variant="contained" disabled={mutation.isPending || (!body.trim() && !image)} onClick={() => void submit()}>{t("attachments.publish")}</Button>
    </DialogActions>
  </Dialog>;
}
