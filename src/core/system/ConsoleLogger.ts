export interface LogEntry {
  message: string;
  type: 'info' | 'warn' | 'error' | 'command';
  timestamp: number;
}

export class ConsoleLogger {
  private logs: LogEntry[] = [];
  public onLogAdded?: () => void;

  public log(message: string, type: 'info' | 'warn' | 'error' | 'command' = 'info') {
    this.logs.push({ message, type, timestamp: Date.now() });
    if (this.onLogAdded) this.onLogAdded();
  }

  public getLogs() {
    return this.logs;
  }
}
