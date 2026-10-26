import { useState } from "react";
import { Alert, Avatar, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { usePostByPublicId, useRepostPost, useUnrepostPost } from "../hooks/posts/usePosts";
import { buildAvatarUrl, buildMediaUrl } from "../lib/media";
import type { IPost } from "../types";
import RichText from "./RichText";
import ImageAttachmentInput from "./ImageAttachmentInput";
import CharacterCounter, { POST_CHARACTER_LIMIT } from "./CharacterCounter";

interface Props { post: IPost; onClose: () => void; hasReposted?: boolean; onUndone?: () => void }

export default function RepostDialog({ post, onClose, hasReposted, onUndone }: Props): React.ReactElement {
  const { t } = useTranslation();
  const target = post.type === "repost" && post.repostOf ? post.repostOf : post;
  const detail = usePostByPublicId(target.publicId);
  const original = detail.data ?? target;
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const repost = useRepostPost();
  const undo = useUnrepostPost();
  const pending = repost.isPending || undo.isPending;
  const alreadyReposted = hasReposted || detail.data?.isRepostedByViewer;
  const imageUrl = buildMediaUrl(original.image?.url);
  const submit = (): void => {
    if (pending || detail.isPending || detail.isError || alreadyReposted || body.length > POST_CHARACTER_LIMIT) return;
    repost.mutate({ postPublicId: target.publicId, body: body.trim() || undefined, image: image ?? undefined }, { onSuccess: onClose });
  };
  return <Dialog open onClose={pending ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="repost-title"
    PaperProps={{ sx: { borderRadius: 4, m: 2, width: "calc(100% - 32px)" } }}>
    <DialogTitle id="repost-title">{t("composer.repost")}</DialogTitle>
    <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {alreadyReposted ? <Typography variant="body2" color="text.secondary">{t("composer.already_reposted")}</Typography> : <>
        <TextField autoFocus fullWidth multiline minRows={2} maxRows={8} value={body} disabled={pending}
          label={t("composer.optional_comment")} inputProps={{ maxLength: POST_CHARACTER_LIMIT }} onChange={(event) => setBody(event.target.value)} sx={{ mt: 1 }}
          onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); } }} />
        <CharacterCounter value={body} limit={POST_CHARACTER_LIMIT} />
        <ImageAttachmentInput file={image} onChange={setImage} disabled={pending} />
      </>}
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 4, p: 1.5, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, minWidth: 0 }}>
          <Avatar src={buildAvatarUrl(original.user.avatar, 32)} sx={{ width: 32, height: 32 }}>{original.user.username.charAt(0)}</Avatar>
          <Box sx={{ minWidth: 0 }}><Typography noWrap variant="body2" fontWeight={700}>{original.user.username}</Typography><Typography noWrap variant="caption" color="text.secondary">@{original.user.handle}</Typography></Box>
        </Box>
        {original.body && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden" }}><RichText text={original.body} /></Typography>}
        {imageUrl && <Box component="img" src={imageUrl} alt={t("post.reposted_content")} sx={{ display: "block", maxWidth: "100%", maxHeight: 180, mt: 1, borderRadius: 3, objectFit: "contain" }} />}
      </Box>
      {detail.isError && <Alert severity="error" action={<Button onClick={() => void detail.refetch()}>{t("feed.retry")}</Button>}>{t("feed.load_failed")}</Alert>}
      {(repost.isError || undo.isError) && <Alert severity="error">{t("post.repost_failed")}</Alert>}
    </DialogContent>
    <DialogActions sx={{ p: 2 }}>
      <Button disabled={pending} onClick={onClose}>{t("common.cancel")}</Button>
      {alreadyReposted ? <Button variant="outlined" disabled={pending} onClick={() => undo.mutate({ postPublicId: target.publicId }, { onSuccess: () => { onClose(); onUndone?.(); } })}>{t("post.undo_repost")}</Button>
        : <Button variant="contained" disabled={pending || detail.isPending || detail.isError || body.length > POST_CHARACTER_LIMIT} onClick={submit}>{t(pending ? "composer.reposting" : "composer.repost")}</Button>}
    </DialogActions>
  </Dialog>;
}
