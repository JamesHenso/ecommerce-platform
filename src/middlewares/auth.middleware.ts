import type {Request, Response, NextFunction} from "express"
import { AppError } from "../utils/appError.js";
import { verifyToken } from "../utils/jwt.js";
import { Role } from "@prisma/client";

export const authenticate = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const authHeader = req.headers.authorization;

    if(!authHeader || !authHeader.startsWith("Bearer ")){
        throw new AppError("Please Login", 401)
    }

    const token = authHeader.split(" ")[1]
    try{
        const decoded = verifyToken(token);
        req.user = decoded
        next()
    } catch(error){
        throw new AppError("Invalid Token", 401)
    }
}

export const authorize = (allowedRoles: Role[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if(!req.user){
            throw new AppError("Not authenticate", 401)
        }
        if(!allowedRoles.includes(req.user.role)){
            throw new AppError("Not allowd", 403)
        }
        next()
    }
}