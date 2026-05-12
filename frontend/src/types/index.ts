import {
  InfiniteData,
  UseInfiniteQueryResult,
  UseMutationResult,
  useQuery,
  UseQueryResult,
} from "@tanstack/react-query";
import { Id } from "react-toastify";

// Base user interface matching backend DTOs
export interface PublicUserDTO {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
  cover: string;
  bio: string;
  createdAt: Date;
  postCount: number;
  followerCount: number;
  followingCount: number;
}

export interface AuthenticatedUserDTO extends PublicUserDTO {
  email: string; // Only for the user themselves
  isEmailVerified: boolean;
  isAdmin?: boolean;
}

export interface AccountInfoDTO {
  publicId: string;
  handle: string;
  username: string;
  email: string;
  isEmailVerified: boolean;
  createdAt: string;
  registrationIp?: string;
}

export interface AdminUserDTO extends AuthenticatedUserDTO {
  isAdmin: boolean;
  isBanned: boolean;
  bannedAt?: Date;
  bannedReason?: string;
  bannedBy?: string;
  updatedAt: Date;
  registrationIp?: string;
  lastActive?: Date;
  lastIp?: string;
}

// Main user type for the frontend - can be any of the DTO types
export type IUser = PublicUserDTO | AuthenticatedUserDTO | AdminUserDTO;

export interface ITag {
  id: string;
  tag: string;
  count?: number;
  modifiedAt?: Date;
  score?: number;
}

export interface IPost {
  publicId: string;
  slug?: string;
  body?: string; // Post text
  type?: "original" | "repost";
  repostCount?: number;
  repostOf?: {
    publicId: string;
    user: {
      publicId: string;
      handle: string;
      username: string;
      avatar: string;
    };
    body?: string;
    slug?: string;
    image?: {
      url: string;
      publicId: string;
    } | null;
    likes?: number;
    repostCount?: number;
    commentsCount?: number;
  };

  // Image data
  image?: {
    url: string;
    publicId: string;
  } | null;

  // Legacy: Keep url at top level for backward compatibility
  url?: string;
  imagePublicId?: string;

  tags: string[];

  user: {
    publicId: string;
    handle: string;
    username: string;
    avatar: string;
  };

  // Community info for community posts
  community?: {
    publicId: string;
    name: string;
    slug: string;
    avatar?: string;
  } | null;

  likes: number;
  commentsCount: number;
  viewsCount: number;
  createdAt: Date;

  isLikedByViewer: boolean;
  isFavoritedByViewer: boolean;
  isRepostedByViewer: boolean;
  canDelete?: boolean;
  authorCommunityRole?: "admin" | "moderator" | "member";
}

/**
 * Legacy IImage interface - for backward compatibility
 */
export interface IImage extends IPost {
  url: string; // Required for images
  title?: string;
}

/**
 * Type guard to check if post has an image
 */
export function isImagePost(post: IPost): post is IImage {
  return !!post.image || !!post.url;
}

/**
 * Type guard for text-only posts
 */
export function isTextPost(post: IPost): boolean {
  return !!post.body && !post.image && !post.url;
}

export interface IComment {
  id: string;
  content: string;
  postPublicId: string;
  parentId?: string | null;
  replyCount?: number;
  depth?: number;
  likesCount?: number;
  isLikedByViewer?: boolean;
  user: {
    publicId: string;
    handle?: string;
    username: string;
    avatar?: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
  isDeleted?: boolean;
  deletedBy?: "user" | "admin" | null;
}

export interface CommentCreateDto {
  content: string;
  parentId?: string;
}

export interface CommentUpdateDto {
  content: string;
}

export interface CommentsPaginationResponse {
  comments: IComment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type PageParam = number;

export type ImagePageData = {
  data: IImage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  profile: PublicUserDTO;
};

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  nextCursor?: string;
  prevCursor?: string;
  hasMore?: boolean;
}
export interface UseImagesResult {
  imagesQuery: UseInfiniteQueryResult<InfiniteData<PaginatedResponse<IImage>>, Error>;
  imageByIdQuery: (id: string) => UseQueryResult<IImage, Error>;
  uploadImageMutation: UseMutationResult<unknown, Error, unknown, unknown>;
  tagsQuery: UseQueryResult<string[], Error>;
  imagesByTagQuery: (
    tags: string[],
    page: number,
    limit: number,
  ) => UseInfiniteQueryResult<InfiniteData<PaginatedResponse<IImage>>, Error>;
  deleteImage: (id: string) => Promise<void>;
}

export interface GalleryProps {
  posts: (IImage | IPost)[];
  fetchNextPage: () => void;
  hasNextPage?: boolean;
  isFetchingNext?: boolean;
  isLoadingAll?: boolean;
  isFetchingAll?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  variant?: "feed" | "media";
}

export interface Notification {
  id: string;
  userId: string;
  actionType: string; // 'like' | 'comment' | 'follow' | 'message' | 'security_alert'
  actorId: string; // actor's publicId
  actorUsername?: string; // denormalized username
  actorHandle?: string;
  actorAvatar?: string; // actor avatar URL
  targetId?: string; // post/image/conversation publicId
  targetType?: string; // 'post' | 'image' | 'user' | 'conversation'
  targetPreview?: string; // preview text/snippet
  timestamp: string;
  isRead: boolean;
}

export interface NotificationPage {
  data: Notification[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface MessageAttachment {
  url: string;
  type: string;
  mimeType?: string;
  thumbnailUrl?: string;
}

export interface MessageDTO {
  publicId: string;
  conversationId: string;
  body: string;
  sender: {
    publicId: string;
    handle: string;
    username: string;
    avatar: string;
  };
  attachments: MessageAttachment[];
  status: "sent" | "delivered" | "read";
  createdAt: string;
  readBy: string[];
}

export interface ConversationParticipantDTO {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
}

export interface ConversationSummaryDTO {
  publicId: string;
  participants: ConversationParticipantDTO[];
  lastMessage?: MessageDTO | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  isGroup: boolean;
  title?: string;
}

export type MessagingUpdatePayload =
  | {
      type: "message_sent";
      conversationId: string;
      messageId?: string;
      senderId: string;
      timestamp: string;
    }
  | {
      type: "message_status_updated";
      conversationId: string;
      timestamp: string;
      status: "delivered" | "read";
    };

export interface UserUserResult {
  useCurrentUser: () => IUser | null;
  useUserPosts: (userId: string) => UseInfiniteQueryResult<
    InfiniteData<
      {
        data: IPost[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      },
      unknown
    >,
    Error
  >;
  userQuery: ReturnType<typeof useQuery>;
}

export interface UploadFormProps {
  onClose: () => void;
}

export interface AuthContextData {
  logout: () => Promise<void>;
  login: (user: AuthenticatedUserDTO | AdminUserDTO) => void;
  error: string | null;
}
export interface ImageCardProps {
  image: IImage;
  onClick: (image: IImage) => void;
}

export interface PostCardProps {
  post: IPost;
}

export interface ImageEditorProps {
  onImageUpload: (croppedImage: Blob | null) => void;
  type: "avatar" | "cover";
  aspectRatio?: number;
  onClose: () => void;
}

export interface EditProfileProps {
  onComplete: () => void;
  notifySuccess: (message: string) => Id;
  notifyError: (message: string) => Id;
  initialData?: IUser | null;
}

export interface ChangePasswordProps {
  onComplete: () => void;
  notifySuccess: (message: string) => Id;
  notifyError: (message: string) => Id;
}

export type RegisterForm = {
  handle: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
};

interface AuthFormField<T> {
  name: keyof T;
  label: string;
  type: string;
  autoComplete?: string;
  required: boolean;
}

export interface AuthFormProps<T> {
  title: string;
  fields: AuthFormField<T>[];
  onSubmit: (formData: T) => void;
  isSubmitting?: boolean;
  error?: string | null;
  submitButtonText: string;
  linkText?: string;
  linkTo?: string;
  initialValues?: Partial<T>;
}

export interface ConversationListResponse {
  conversations: ConversationSummaryDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ConversationMessagesResponse {
  messages: MessageDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SendMessageRequest {
  conversationPublicId?: string;
  recipientPublicId?: string;
  body: string;
  attachments?: MessageAttachment[];
}

export interface InitiateConversationResponse {
  conversation: ConversationSummaryDTO;
}

// Who to follow suggestions
export interface SuggestedUser {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
  bio?: string;
  followerCount: number;
  postCount: number;
  totalLikes: number;
  score: number;
}

export interface HandleSuggestion {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
}

export interface HandleSuggestionResponse {
  users: HandleSuggestion[];
}

export type HandleSuggestionContext = "mention" | "search";

export interface WhoToFollowResponse {
  suggestions: SuggestedUser[];
  cached: boolean;
  timestamp: string;
}

export interface ICommunityMember {
  userId: {
    publicId: string;
    handle?: string;
    username: string;
    avatar?: string;
  };
  role: "admin" | "moderator" | "member";
  joinedAt: Date;
}

export interface ICommunity {
  publicId: string;
  name: string;
  slug: string;
  description: string;
  avatar?: string;
  coverPhoto?: string;
  stats: {
    memberCount: number;
    postCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
  isMember?: boolean;
  isCreator?: boolean;
  isAdmin?: boolean;
}

export interface CreateCommunityDTO {
  name: string;
  description: string;
  avatar?: File;
}

export interface UpdateCommunityDTO {
  name?: string;
  description?: string;
  avatar?: File;
  coverPhoto?: File;
}
