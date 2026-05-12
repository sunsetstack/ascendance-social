import "reflect-metadata";
import { container } from "tsyringe";
import { logger } from "@/utils/winston";
import { NotificationService } from "@/services/notification.service";
import User from "@/models/user.model";
import { RequestLogModel } from "@/models/requestLog.model";
import { SystemActor } from "@/utils/actors/SystemActor";

export class IpMonitorWorker {
    private CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

    private notificationService!: NotificationService;
    private timer?: NodeJS.Timeout;
    private running = false;

    constructor() {}

    async init(): Promise<void> {
        this.notificationService = container.resolve(NotificationService);
        logger.info("[ip-monitor] Worker initialized");
    }

    start(): void {
        if (this.running) return;
        this.running = true;

        logger.info(`[ip-monitor] Worker started. Running check every ${this.CHECK_INTERVAL_MS / 1000 / 60} minutes`);

        // Run immediately on start
        this.runCheck().catch((err) => {
            logger.error("[ip-monitor] Initial check failed", { error: err });
        });

        this.timer = setInterval(() => {
            this.runCheck().catch((err) => {
                logger.error("[ip-monitor] Check failed", { error: err });
            });
        }, this.CHECK_INTERVAL_MS);
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
        }
        logger.info("[ip-monitor] Worker stopped");
    }

    private async runCheck(): Promise<void> {
        logger.info("[ip-monitor] Starting IP check...");
        const fourHoursAgo = new Date(Date.now() - this.CHECK_INTERVAL_MS);

        try {
            // 1. Get unique IPs active in the last 4 hours
            interface IpAggregationResult {
                _id: string;
            }

            const recentLogs = await RequestLogModel.aggregate<IpAggregationResult>([
                {
                    $match: {
                        timestamp: { $gte: fourHoursAgo }
                    }
                },
                {
                    $group: {
                        _id: "$metadata.ip"
                    }
                }
            ]);

            const recentIps: string[] = recentLogs
                .map((log) => log._id)
                .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0);

            if (recentIps.length === 0) {
                logger.info("[ip-monitor] No active IPs in the last 4 hours.");
                return;
            }

            logger.info(`[ip-monitor] Found ${recentIps.length} unique IPs active recently.`);

            const newIps: string[] = [];
            const BATCH_SIZE = 500;

            // 2. Check if these IPs existed before 4 hours ago (Batched)
            for (let i = 0; i < recentIps.length; i += BATCH_SIZE) {
                const batch = recentIps.slice(i, i + BATCH_SIZE);

                // Find which IPs from this batch ALREADY EXIST in history
                const knownIpsInBatch = await RequestLogModel.distinct("metadata.ip", {
                    "metadata.ip": { $in: batch },
                    timestamp: { $lt: fourHoursAgo }
                }) as string[];

                const knownSet = new Set(knownIpsInBatch);

                const newInBatch = batch.filter(ip => !knownSet.has(ip));
                newIps.push(...newInBatch);
            }

            if (newIps.length === 0) {
                logger.info("[ip-monitor] No NEW IPs detected.");
                return;
            }

            logger.info(`[ip-monitor] Detected ${newIps.length} NEW IPs: ${newIps.join(", ")}`);

            // 3. Notify Admins
            // We use lean() for performance since we don't need hydration
            const admins = await User.find({ isAdmin: true })
                .select("publicId username")
                .lean<{ publicId: string; username: string }[]>();

            if (admins.length === 0) {
                logger.warn("[ip-monitor] No admins found to notify!");
                return;
            }

            // Send notifications (Parallelized & Robust)
            const notificationPromises = [];
            for (const ip of newIps) {
                for (const admin of admins) {
                    notificationPromises.push(
                        this.notificationService.createNotification({
                            receiverId: admin.publicId,
                            actionType: "security_alert",
                            actorId: SystemActor.id,
                            actorUsername: SystemActor.username,
                            actorHandle: SystemActor.handle,
                            actorAvatar: SystemActor.avatar,
                            targetId: ip,
                            targetType: "ip",
                            targetPreview: `New unknown IP detected: ${ip}`
                        })
                    );
                }
            }

            const results = await Promise.allSettled(notificationPromises);
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;

            logger.info(`[ip-monitor] Notification run complete. Success: ${successCount}, Failures: ${failureCount}`);

        } catch (error) {
            logger.error("[ip-monitor] Error during IP check", { error });
        }
    }
}
