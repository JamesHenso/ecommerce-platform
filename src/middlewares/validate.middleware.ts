import { ZodError, type ZodObject } from "zod";
import type { NextFunction, Request, Response } from "express";

export const validate = (schema: ZodObject) =>
  async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      req.body = parsed.body ?? req.body;
      Object.defineProperty(req, "query", {
        configurable: true,
        enumerable: true,
        value: parsed.query ?? req.query,
        writable: true,
      });
      req.params = (parsed.params ?? req.params) as Request["params"];

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: "error",
          message: "Invalid input data",
          errors: error.issues.map((err) => ({
            field:
              err.path.length > 1
                ? err.path.slice(1).join(".")
                : err.path.join("."),
            message: err.message,
          })),
        });
        return;
      }

      next(error);
    }
  };