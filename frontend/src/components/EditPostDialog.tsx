import { useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useUpdatePost } from "../hooks/posts/usePosts";
import type { IPost } from "../types";
import { buildMediaUrl } from "../lib/media";
import CharacterCounter, { POST_CHARACTER_LIMIT } from "./CharacterCounter";

export default function EditPostDialog({ post, onClose }: { post: IPost; onClose: () => void }): React.ReactElement {
  const { t } = useTranslation();
  const [body, setBody] = useState(post.body ?? "");
  const mutation = useUpdatePost();
  const image = buildMediaUrl(post.image?.url ?? post.url);
  const invalid = body.length > POST_CHARACTER_LIMIT || (!body.trim() && post.type !== "repost" && (!image || !post.tags.length));
  const disabled = invalid || mutation.isPending || body.trim() === (post.body ?? "");
  const submit = (): void => {
    if (disabled) return;
    mutation.mutate({ publicId: post.publicId, body: body.trim() }, { onSuccess: onClose });
  };
  return <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="edit-post-title"
    PaperProps={{ sx: { borderRadius: 4, m: 2, width: "calc(100% - 32px)" } }}>
    <DialogTitle id="edit-post-title">{t("composer.edit_post")}</DialogTitle>
    <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <TextField autoFocus fullWidth multiline minRows={3} maxRows={12} label={t("composer.post_text")} value={body}
        disabled={mutation.isPending} inputProps={{ maxLength: POST_CHARACTER_LIMIT }} sx={{ mt: 1 }}
        onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); } }} />
      <CharacterCounter value={body} limit={POST_CHARACTER_LIMIT} />
      {image && <Box component="img" src={image} alt={t("attachments.preview")} sx={{ maxWidth: "100%", maxHeight: 180, objectFit: "contain", alignSelf: "flex-start", borderRadius: 3 }} />}
      {mutation.isError && <Alert severity="error">{t("composer.edit_failed")}</Alert>}
    </DialogContent>
    <DialogActions sx={{ p: 2 }}><Button onClick={onClose} disabled={mutation.isPending}>{t("common.cancel")}</Button>
      <Button variant="contained" onClick={submit} disabled={disabled}>{t(mutation.isPending ? "composer.saving" : "common.save")}</Button></DialogActions>
  </Dialog>;
}
