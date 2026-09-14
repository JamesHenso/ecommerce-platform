import type {Request, Response, NextFunction} from "express"
import * as authService from "../auth/auth.service.js"

export const handleRegister = async (
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try{
        const result = await authService.registerUser(req.body)
        res.status(201).json({
            success: true,
            message: "Register Successfully",
            data: result,
        })
    } catch(error){
        next(error)
    }
}

export const handleLogin = async(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try{
        const result = await authService.loginUser(req.body)
        res.status(200).json({
            success: true,
            message: "Login Successfully",
            data: result,
        })
    } catch(error){
        next(error)
    }
}

export const handleGetMe = async(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try{
        res.status(200).json({
            success: true,
            data: req.user  
        })
    } catch(error){
        next(error)
    }
}