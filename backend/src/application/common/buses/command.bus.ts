import { injectable } from "tsyringe";
import { ICommand } from "../interfaces/command.interface";
import { Errors } from "@/utils/errors";
import { addRequestContextBreadcrumb } from "@/runtime/request-context";
import type {
  BusHandler,
  BusRequestClass,
  CommandHandlers,
  HandledRequest,
  HandledResult,
  HandlerBinding,
} from "./bus-contracts";

@injectable()
export class CommandBus<THandlers extends BusHandler = CommandHandlers> {
  // Maps command types to their handlers.
  private handlers = new Map<string, BusHandler>();

  private resolveCommandType(
    commandType: BusRequestClass<ICommand>,
  ): string {
    if (typeof commandType.type === "string" && commandType.type.length > 0) {
      return commandType.type;
    }

    if (typeof commandType.name === "string" && commandType.name.length > 0) {
      return commandType.name;
    }

    throw Errors.internal(`Could not resolve command type for constructor`);
  }

  /**
   * Registers a command handler for a specific command type.
   * @param commandType - The class constructor of the command type.
   * @param handler - The handler responsible for processing the command.
   */
 
  register(
    ...[commandType, handler]: HandlerBinding<THandlers>
  ): void
  {
    this.handlers.set(this.resolveCommandType(commandType), handler);
  }

  /**
   * Dispatches a command to its corresponding handler.
   * @param command - The command instance to be processed.
   * @returns The result of the command execution.
   * @throws An error if no handler is found for the command.
   */
  dispatch<TCommand extends HandledRequest<THandlers>>(
    command: TCommand,
  ): Promise<HandledResult<THandlers, TCommand>>;
  async dispatch(command: ICommand): Promise<unknown>{
    const handler = this.handlers.get(command.type);
    addRequestContextBreadcrumb("cqrs.command.dispatch", {
      operation: command.type,
    });
    

    if(!handler){
      throw Errors.internal(`No handler found for command ${command.type}`);
    }

    addRequestContextBreadcrumb("cqrs.command.handler.enter", {
      operation: command.type,
    });
    try {
      return await handler.execute(command);
    } catch (error) {
      addRequestContextBreadcrumb("cqrs.command.handler.failed", {
        operation: command.type,
      });
      throw error;
    }
  }

}
