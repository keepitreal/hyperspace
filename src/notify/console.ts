import { formatAlert } from "../log.js";
import type { Alert } from "../types.js";
import type { Notifier } from "./index.js";

/**
 * Console driver. Always enabled. Writes formatted alerts to stdout via
 * the same formatter the status loop already uses, so there is no visual
 * regression compared to the pre-notifier code path.
 */
export class ConsoleNotifier implements Notifier {
  readonly name = "console";
  constructor(private readonly log: { info(msg: string): void }) {}
  async send(alert: Alert): Promise<void> {
    this.log.info(formatAlert(alert));
  }
}
