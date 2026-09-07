import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/appError.js";

export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    if(err instanceof AppError){
        res.status(err.statusCode).json({
            success: false,
            message: err.message
        })
        return;
    }

    if(err instanceof Prisma.PrismaClientKnownRequestError){
        if(err.code === "P2002"){
            const target = (err.meta?.target as string[])?.join(", ") || "fields"
            res.status(409).json({
                success: false,
                message: `Value of ${target} is not available`
            })
            return;
        }
        if(err.code === "P2025"){
            res.status(404).json({
                success: false,
                message: "Record not found"
            })
            return;
        }
    }

    console.error("Unhandled Error: ", err);
    res.status(500).json({
        success: false,
        message: 
            process.env.NODE_ENV === "production" ? "System Error. Try again" : err.message
    })
}