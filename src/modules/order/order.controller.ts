import { Request, Response, NextFunction } from "express";
import * as orderService from "./order.service.js"

export const handleCheckout = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const userId = req.user!.id
        const order = await orderService.checkOutOrder(userId, req.body)
        res.status(200).json({
            success: true,
            message: "Checkout items successfully",
            data: order
        })
    } catch(error){
        next(error)
    }
}

export const handleGetMyOrders = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const userId = req.user!.id
        const orders = await orderService.getUserOrders(userId)
        res.status(200).json({
            success: true,
            data: orders
        })
    } catch(error){
        next(error)
    }
}

export const handleGetOrderDetail = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const userId = req.user!.id
        const order = await orderService.getOrderDetail(userId, String(req.params.id))
        res.status(200).json({
            success: true,
            data: order
        })
    } catch(error){
        next(error)
    }
}