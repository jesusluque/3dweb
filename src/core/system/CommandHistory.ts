export interface Command {
  execute(): void;
  undo(): void;
  readonly description?: string;
  /** UUIDs of DAGNodes this command directly touched (used for per-node history filtering). */
  readonly affectedNodeUuids?: ReadonlySet<string>;
}

export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  
  public onHistoryChanged?: () => void;

  get undoDepth() { return this.undoStack.length; }
  get redoDepth() { return this.redoStack.length; }

  /** Ordered oldest→newest, same direction as undo stack */
  get undoList(): ReadonlyArray<Command> { return this.undoStack; }
  get redoList(): ReadonlyArray<Command> { return this.redoStack; }

  public execute(cmd: Command) {
    cmd.execute();
    this.undoStack.push(cmd);
    this.redoStack = []; // Clear redo stack on new command
    this.notify();
  }

  /** Record a command that has already been applied — do NOT call execute() again. */
  public record(cmd: Command) {
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.notify();
  }

  public undo() {
    const cmd = this.undoStack.pop();
    if (cmd) {
      cmd.undo();
      this.redoStack.push(cmd);
      this.notify();
    }
  }

  public redo() {
    const cmd = this.redoStack.pop();
    if (cmd) {
      cmd.execute();
      this.undoStack.push(cmd);
      this.notify();
    }
  }

  /** Discard all undo/redo history (e.g. on scene load or new scene). */
  public clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  private notify() {
    if (this.onHistoryChanged) this.onHistoryChanged();
  }
}
