import { NextFunction, Request, Response } from "express";

export const adminActionValidation = (requiredFields: string[] = []) => {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const field of requiredFields) {
      if (!req.body[field]) {
        return res.status(400).json({
          error: `Missing required field: ${field}`,
          requiredFields,
        });
      }
    }

    if (
      req.params.publicId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        req.params.publicId,
      )
    ) {
      return res.status(400).json({ error: "Invalid publicId format" });
    }

    next();
  };
};
