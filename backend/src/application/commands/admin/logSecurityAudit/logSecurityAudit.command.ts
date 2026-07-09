import { ICommand } from "@/application/common/interfaces/command.interface";
import { RecordSecurityAuditEventInput } from "@/services/security-audit.service";

export type LogSecurityAuditPayload = RecordSecurityAuditEventInput;

export class LogSecurityAuditCommand implements ICommand {
  readonly type = "LogSecurityAuditCommand";

  constructor(public readonly payload: LogSecurityAuditPayload) {}
}
