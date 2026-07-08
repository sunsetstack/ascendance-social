import { NextFunction, Request, RequestHandler, Response } from "express";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { logger } from "@/utils/winston";

export function createAdminOnlyMiddleware(
  userReadRepository: IUserReadRepository,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const decodedUser = req.decodedUser;

      if (!decodedUser) {
        logger.warn("Unauthenticated admin access attempt", {
          event: "security.admin_access.unauthenticated",
          method: req.method,
          route: req.path,
          ip: req.ip,
        });
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!decodedUser.isAdmin) {
        logger.warn("Unauthorized admin access attempt", {
          event: "security.admin_access.unauthorized",
          method: req.method,
          route: req.path,
          userId: decodedUser.publicId,
          username: decodedUser.username,
          ip: req.ip,
        });
        return res.status(403).json({ error: "Admin privileges required" });
      }

      const user = await userReadRepository.findByPublicId(
        decodedUser.publicId,
      );

      if (!user) {
        logger.warn("Admin user not found in database", {
          event: "security.admin_access.user_not_found",
          userId: decodedUser.publicId,
        });
        return res.status(401).json({ error: "User not found" });
      }

      if (user.isBanned) {
        logger.warn("Banned admin attempted access", {
          event: "security.admin_access.banned_user",
          userId: decodedUser.publicId,
          username: decodedUser.username,
          ip: req.ip,
        });
        return res.status(403).json({ error: "Account banned" });
      }

      if (!user.isAdmin) {
        logger.warn("Admin JWT no longer matches database role", {
          event: "security.admin_access.role_mismatch",
          userId: decodedUser.publicId,
          username: decodedUser.username,
        });
        return res.status(403).json({ error: "Admin privileges required" });
      }

      const adminEmailsEnv = process.env.ADMIN_EMAILS;
      if (adminEmailsEnv) {
        const allowedEmails = adminEmailsEnv
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter((email) => email.length > 0);

        if (user.email && !allowedEmails.includes(user.email.toLowerCase())) {
          logger.warn("Admin email not in allowlist", {
            event: "security.admin_access.email_not_allowed",
            userId: decodedUser.publicId,
            username: decodedUser.username,
            ip: req.ip,
          });
          return res
            .status(403)
            .json({ error: "Admin privileges restricted" });
        }
      }

      logger.info("Admin action authorized", {
        event: "admin.action.authorized",
        userId: decodedUser.publicId,
        username: decodedUser.username,
        method: req.method,
        route: req.path,
        ip: req.ip,
      });

      req.adminContext = {
        adminId: decodedUser.publicId,
        adminUsername: decodedUser.username,
        timestamp: new Date(),
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      };

      next();
    } catch (error) {
      logger.error("Admin middleware failed", {
        event: "security.admin_access.middleware_failed",
        error,
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  };
}
