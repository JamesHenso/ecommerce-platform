import { Request, Response, NextFunction } from "express";
import * as catalogService from "../catalog/catalog.service.js"
import { GetProductsQuery } from "./catalog.schema.js";

export const handleCreateCategory = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const category = await catalogService.createCategory(req.body)
        res.status(201).json({
            success: true,
            data: category
        })
    } catch(error){
        next(error)
    }
}

export const handleGetCategories = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const categories = await catalogService.getAllCategories()
        res.status(200).json({
            success: true,
            data: categories
        })
    } catch(error){
        next(error)
    }
}

export const handleGetProducts = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const result = await catalogService.getProducts(req.query as unknown as GetProductsQuery)
        res.status(200).json({
            success: true,
            data: result
        })
    } catch(error){
        next(error)
    }
}

export const handleGetProductById = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const product = await catalogService.getProductById(String(req.params.id))
        res.status(200).json({
            success: true,
            data: product
        })
    } catch(error){
        next(error)
    }
}

export const handleCreateProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const product = await catalogService.createProduct(req.body)
        res.status(201).json({
            success: true,
            message: "Create product successfully",
            data: product
        })
    } catch (error){
        next(error) 
    }
}

export const handleUpdateProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        const product = await catalogService.updateProduct(String(req.params.id), req.body)
        res.status(200).json({
            success: true,
            message: "Update product successfully",
            data: product
        })
    } catch(error){
        next(error)
    }
}

export const handleDeleteProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try{
        await catalogService.deleteProduct(String(req.params.id))
        res.status(200).json({
            success: true,
            message: "Delete product successfully",
        })
    } catch(error){
        next(error)
    }
}