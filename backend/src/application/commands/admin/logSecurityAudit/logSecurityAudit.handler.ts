import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { SecurityAuditService } from "@/services/security-audit.service";
import { TOKENS } from "@/types/tokens";
import { LogSecurityAuditCommand } from "./logSecurityAudit.command";

@injectable()
export class LogSecurityAuditCommandHandler implements ICommandHandler<
  LogSecurityAuditCommand,
  void
> {
  constructor(
    @inject(TOKENS.Services.SecurityAudit)
    private readonly securityAuditService: SecurityAuditService,
  ) {}

  async execute(command: LogSecurityAuditCommand): Promise<void> {
    await this.securityAuditService.record(command.payload);
  }
}
