import { Request, Response, NextFunction } from "express";
import * as cartService from "./cart.service.js"

export const handleGetCart = async(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const userId = req.user!.id
        const cart = await cartService.getCart(userId)
        res.status(200).json({
            success: true,
            data: cart
        })
    } catch(error){
        next(error)
    }
}

export const handleAddItemToCart = async(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const userId = req.user!.id
        const item = await cartService.addItemToCart(userId, req.body)
        res.status(200).json({
            success: true,
            message: "Add item to cart successfully",
            data: item
        })
    } catch(error){
        next(error)
    }
}

export const handleUpdateCartItem = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const userId = req.user!.id
        const item = await cartService.updateCartItem(userId, String(req.params.id), req.body)
        res.status(200).json({
            success: true,
            message: "Update item successfully",
            data: item
        })
    } catch(error){
        next(error)
    }
}

export const handleDeleteCartItem = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const userId = req.user!.id
        await cartService.removeCartItem(userId, String(req.params.id))
        res.status(200).json({
            success: true,
            message: "Delete item successfully"
        })
    } catch(error){
        next(error)
    }
}