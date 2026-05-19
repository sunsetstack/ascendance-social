import { injectable } from "tsyringe";
import { ICommandHandler } from "../interfaces/command-handler.interface";
import { ICommand } from "../interfaces/command.interface";
import { Errors } from "@/utils/errors";

type CommandClass<TCommand extends ICommand> = {
  new (...args: any[]): TCommand;
  readonly type?: TCommand["type"];
};

@injectable()
export class CommandBus {
  // Registering handlers in a map with command's name as key. 
  private handlers = new Map<string, unknown>(); 

  private resolveCommandType<TCommand extends ICommand>(
    commandType: CommandClass<TCommand>,
  ): TCommand["type"] {
    if (typeof commandType.type === "string" && commandType.type.length > 0) {
      return commandType.type;
    }

    if (typeof commandType.name === "string" && commandType.name.length > 0) {
      return commandType.name as TCommand["type"];
    }

    throw Errors.internal(`Could not resolve command type for constructor`);
  }

  /**
   * Registers a command handler for a specific command type.
   * Can register any TCommand type that implements the ICommand interface. 
   * TResult is the return type of the command handler
   * @param commandType - The class constructor of the command type.
   * @param handler - The handler responsible for processing the command.
   */
 
  register<TCommand extends ICommand, TResult>(
    // commandType should be a class constructor that can create instances of TCommand
    // new(...args: any[]) is a constructor signature that takes an array of arguments. 
    // any[] is explicitly required here due to TypeScript constructor variance (unknown[] fails).
    commandType: CommandClass<TCommand>, 

    // An instance of a command handler. 
    // Returns a Promise<TResult> as specified in the ICommandHandler interface.
    handler: ICommandHandler<TCommand, TResult> 
  ) : void
  {
    // Registering the handler in the handlers map. 
    // Types are verified at boundary (by generics), so internal map uses unknown
    this.handlers.set(this.resolveCommandType(commandType), handler);
  }

  /**
   * Dispatches a command to its corresponding handler.
   * @param command - The command instance to be processed.
   * @returns The result of the command execution.
   * @throws An error if no handler is found for the command.
   */
  async dispatch<TResult>(command: ICommand): Promise<TResult>{
    const handler = this.handlers.get(command.type) as ICommandHandler<ICommand, TResult> | undefined; 
    

    if(!handler){
      throw Errors.internal(`No handler found for command ${command.type}`);
    }

    return handler.execute(command);
  }

}
