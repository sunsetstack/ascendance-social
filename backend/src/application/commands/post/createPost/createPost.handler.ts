import { inject, injectable } from "tsyringe";
import { CreatePostCommand } from "./createPost.command";
import { PostCreationSaga } from "./PostCreationSaga";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { TagService } from "@/services/tag.service";
import { ImageService } from "@/services/image.service";
import { RedisService } from "@/services/redis.service";
import { DTOService } from "@/services/dto.service";
import { UnitOfWork } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { PostDTO } from "@/types";
import { TOKENS } from "@/types/tokens";

@injectable()
export class CreatePostCommandHandler implements ICommandHandler<
  CreatePostCommand,
  PostDTO
> {
  constructor(
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly postWriteRepository: IPostWriteRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Repositories.Community)
    private readonly communityRepository: CommunityRepository,
    @inject(TOKENS.Repositories.CommunityMember)
    private readonly communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Services.Tag) private readonly tagService: TagService,
    @inject(TOKENS.Services.Image) private readonly imageService: ImageService,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreatePostCommand): Promise<PostDTO> {
    const saga = new PostCreationSaga({
      userReadRepository: this.userReadRepository,
      userWriteRepository: this.userWriteRepository,
      postReadRepository: this.postReadRepository,
      postWriteRepository: this.postWriteRepository,
      communityRepository: this.communityRepository,
      communityMemberRepository: this.communityMemberRepository,
      tagService: this.tagService,
      imageService: this.imageService,
      redisService: this.redisService,
      dtoService: this.dtoService,
      unitOfWork: this.unitOfWork,
      eventBus: this.eventBus,
    });

    return saga.execute(command);
  }
}
