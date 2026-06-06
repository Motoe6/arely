import type { AlertNotifier } from "./notifier-types.js";
import type { Alert } from "../alert-rules.js";
import { logger } from "../../logger.js";

export class LogNotifier implements AlertNotifier {
  async send(alert: Alert): Promise<void> {
    logger.info("notifier", `Alert [${alert.severity}] ${alert.message}`, {
      metadata: {
        ruleId: alert.ruleId,
        severity: alert.severity,
        category: alert.category,
        metric: alert.metric,
        threshold: alert.threshold,
        target: alert.target,
      },
    });
  }
}
