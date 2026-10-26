import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from "@mui/material";
import {
  DeleteOutline,
  DeleteForever,
  LockOutlined,
  LockOpen,
  MoreVert,
} from "@mui/icons-material";
import type { ConversationSummaryDTO } from "../../types";
import type { ConversationAction } from "../../api/messagingApi";
import { useManageConversation } from "../../hooks/messaging/useManageConversation";

interface Props {
  conversation: ConversationSummaryDTO;
  isAdmin: boolean;
  onRemoved: (id: string) => void;
  children: ReactNode;
}

export function ConversationActions({
  conversation,
  isAdmin,
  onRemoved,
  children,
}: Props) {
  const mutation = useManageConversation();
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const [confirmation, setConfirmation] = useState<ConversationAction | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const gesture = useRef<{ x: number; y: number; horizontal: boolean } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntil = useRef(0);
  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => () => cancelHold(), []);
  useEffect(() => {
    if (conversation.isLocked) setOffset(0);
  }, [conversation.isLocked]);

  const openMenu = (left: number, top: number) => {
    setOffset(0);
    setMenu({ left, top });
  };
  const startGesture = (event: PointerEvent<HTMLElement>) => {
    if (
      event.pointerType !== "touch" ||
      !event.currentTarget.contains(event.target as Node) ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    cancelHold();
    gesture.current = { x: event.clientX, y: event.clientY, horizontal: false };
    const { clientX, clientY } = event;
    timer.current = setTimeout(() => {
      gesture.current = null;
      suppressClickUntil.current = Date.now() + 700;
      openMenu(clientX, clientY);
    }, 550);
  };
  const moveGesture = (event: PointerEvent<HTMLElement>) => {
    const start = gesture.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancelHold();
    if (
      !start.horizontal &&
      Math.abs(dy) > 12 &&
      Math.abs(dy) >= Math.abs(dx)
    ) {
      gesture.current = null;
      return;
    }
    if (
      !conversation.isLocked &&
      (start.horizontal || Math.abs(dx) > Math.abs(dy) + 12)
    ) {
      start.horizontal = true;
      setOffset(Math.max(-88, Math.min(0, dx)));
    }
  };
  const endGesture = () => {
    cancelHold();
    if (gesture.current?.horizontal) {
      suppressClickUntil.current = Date.now() + 400;
      setOffset((current) => (current < -40 ? -88 : 0));
    }
    gesture.current = null;
  };
  const chooseAction = (action: ConversationAction) => {
    setMenu(null);
    setOffset(0);
    setError(null);
    setConfirmation(action);
  };
  const confirmAction = async () => {
    if (!confirmation || mutation.isPending) return;
    const action = confirmation;
    setError(null);
    try {
      await mutation.mutateAsync({
        conversationId: conversation.publicId,
        action,
      });
      setConfirmation(null);
      if (action === "delete" || action === "purge")
        onRemoved(conversation.publicId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to update conversation.",
      );
    }
  };
  const label =
    confirmation === "purge"
      ? "Purge"
      : confirmation === "lock"
        ? "Lock"
        : confirmation === "unlock"
          ? "Unlock"
          : "Delete";

  return (
    <Box
      component="li"
      sx={{
        position: "relative",
        overflow: "hidden",
        listStyle: "none",
        touchAction: "pan-y",
      }}
      onContextMenu={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        cancelHold();
        gesture.current = null;
        suppressClickUntil.current = Date.now() + 700;
        openMenu(event.clientX, event.clientY);
      }}
      onPointerDown={startGesture}
      onPointerMove={moveGesture}
      onPointerUp={endGesture}
      onPointerCancel={() => {
        cancelHold();
        gesture.current = null;
        setOffset(0);
      }}
      onClickCapture={(event) => {
        if (
          Date.now() < suppressClickUntil.current &&
          event.currentTarget.contains(event.target as Node) &&
          !(event.target as HTMLElement).closest("button")
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <Button
        color="error"
        disabled={conversation.isLocked || mutation.isPending}
        tabIndex={offset ? 0 : -1}
        aria-hidden={!offset}
        onClick={() => chooseAction("delete")}
        sx={{
          position: "absolute",
          inset: "0 0 0 auto",
          width: 88,
          borderRadius: 0,
          bgcolor: "error.main",
          color: "error.contrastText",
          "&:hover": { bgcolor: "error.dark" },
          visibility: offset ? "visible" : "hidden",
        }}
      >
        Delete
      </Button>
      <Box
        sx={{
          transform: `translateX(${offset}px)`,
          bgcolor: "background.paper",
          position: "relative",
          transition: gesture.current?.horizontal
            ? "none"
            : "transform 150ms ease",
        }}
      >
        {children}
        <Tooltip title="Conversation options">
          <IconButton
            size="small"
            aria-label="Conversation options"
            disabled={mutation.isPending}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu(rect.left, rect.bottom);
            }}
            sx={{ position: "absolute", right: 4, top: 14 }}
          >
            <MoreVert fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ?? undefined}
      >
        <MenuItem
          disabled={conversation.isLocked || mutation.isPending}
          onClick={() => chooseAction("delete")}
          sx={{ color: "error.main", gap: 1 }}
        >
          <DeleteOutline fontSize="small" /> Delete conversation
        </MenuItem>
        {isAdmin && (
          <MenuItem
            disabled={mutation.isPending}
            onClick={() =>
              chooseAction(conversation.isLocked ? "unlock" : "lock")
            }
            sx={{ gap: 1 }}
          >
            {conversation.isLocked ? (
              <LockOpen fontSize="small" />
            ) : (
              <LockOutlined fontSize="small" />
            )}
            {conversation.isLocked
              ? "Unlock conversation"
              : "Lock conversation"}
          </MenuItem>
        )}
        {isAdmin && (
          <MenuItem
            disabled={mutation.isPending}
            onClick={() => chooseAction("purge")}
            sx={{ color: "error.main", gap: 1 }}
          >
            <DeleteForever fontSize="small" /> Purge conversation
          </MenuItem>
        )}
      </Menu>
      <Dialog
        open={Boolean(confirmation)}
        onClose={() => {
          if (!mutation.isPending) setConfirmation(null);
        }}
      >
        <DialogTitle>{label} conversation?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmation === "purge"
              ? "Permanently delete this conversation and all its messages for every participant. This cannot be undone."
              : confirmation === "lock"
                ? "Participants will be able to read this conversation, but cannot send, edit, or delete messages or delete the conversation."
                : confirmation === "unlock"
                  ? "Allow participants to send messages and delete this conversation again."
                  : "Delete this conversation and its history from your inbox. The other participant keeps their copy. New messages will start a fresh history for you."}
          </DialogContentText>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            disabled={mutation.isPending}
            onClick={() => setConfirmation(null)}
          >
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending}
            color={
              confirmation === "purge" || confirmation === "delete"
                ? "error"
                : "primary"
            }
            onClick={() => void confirmAction()}
          >
            {mutation.isPending ? "Working..." : label}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
