import { injectable } from "tsyringe";
import {
  FeedPost,
  ICommunity,
  ICommunityMember,
  IMessage,
  IMessagePopulated,
  IPost,
  IUser,
  MessageDTO,
  PostDTO,
} from "@/types";
import { ConversationPublicId } from "@/types/branded";
import {
  toCommunityDTO as mapCommunityDTO,
  toCommunityMemberDTO as mapCommunityMemberDTO,
} from "./dto/community.mapper";
import { toPublicMessageDTO as mapPublicMessageDTO } from "./dto/message.mapper";
import { toPostDTO as mapPostDTO } from "./dto/post.mapper";
import {
  toAccountInfoDTO as mapAccountInfoDTO,
  toAdminDTO as mapAdminDTO,
  toAuthenticatedUserDTO as mapAuthenticatedUserDTO,
  toHandleSuggestionDTO as mapHandleSuggestionDTO,
  toPublicUserDTO as mapPublicUserDTO,
} from "./dto/user.mapper";
import type {
  AccountInfoDTO,
  AdminUserDTO,
  AuthenticatedUserDTO,
  CommunityDTO,
  CommunityMemberDTO,
  HandleSuggestionDTO,
  PublicUserDTO,
} from "./dto/dto.types";

export type {
  AccountInfoDTO,
  AdminUserDTO,
  AuthenticatedUserDTO,
  CommunityDTO,
  CommunityMemberDTO,
  HandleSuggestionDTO,
  PublicUserDTO,
} from "./dto/dto.types";

@injectable()
export class DTOService {
  toPostDTO(post: IPost | FeedPost): PostDTO {
    return mapPostDTO(post);
  }

  toCommunityDTO(
    community: ICommunity,
    options?: {
      memberCount?: number;
      isMember?: boolean;
      isCreator?: boolean;
      isAdmin?: boolean;
    },
  ): CommunityDTO {
    return mapCommunityDTO(community, options);
  }

  toCommunityMemberDTO(member: ICommunityMember): CommunityMemberDTO {
    return mapCommunityMemberDTO(member);
  }

  toPublicUserDTO(user: IUser, _viewerUserId?: string): PublicUserDTO {
    return mapPublicUserDTO(user);
  }

  toHandleSuggestionDTO(user: IUser): HandleSuggestionDTO {
    return mapHandleSuggestionDTO(user);
  }

  toAuthenticatedUserDTO(user: IUser): AuthenticatedUserDTO {
    return mapAuthenticatedUserDTO(user);
  }

  toAccountInfoDTO(user: IUser): AccountInfoDTO {
    return mapAccountInfoDTO(user);
  }

  toPublicDTO(user: IUser): PublicUserDTO {
    return mapPublicUserDTO(user);
  }

  toAdminDTO(user: IUser): AdminUserDTO {
    return mapAdminDTO(user);
  }

  toPublicMessageDTO(
    message: IMessage | IMessagePopulated,
    conversationPublicId: ConversationPublicId,
  ): MessageDTO {
    return mapPublicMessageDTO(message, conversationPublicId);
  }
}
