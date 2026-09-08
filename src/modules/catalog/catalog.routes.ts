import { Router } from "express";
import { Role } from "@prisma/client";
import * as catalogController from "./catalog.controller.js"
import { validate } from "../../middlewares/validate.middleware.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";
import {
  createCategorySchema,
  createProductSchema,
  updateProductSchema,
  getProductQuerySchema,
} from "./catalog.schema.js";

export const catalogRoutes = Router()

catalogRoutes.get("/categories", catalogController.handleGetCategories)
catalogRoutes.get("/products", validate(getProductQuerySchema), catalogController.handleGetProducts)
catalogRoutes.get("/products/:id", catalogController.handleGetProductById)

catalogRoutes.post(
    "/categories", 
    authenticate,
    authorize([Role.ADMIN]),
    validate(createCategorySchema),
    catalogController.handleCreateCategory
)

catalogRoutes.post(
    "/products",
    authenticate,
    authorize([Role.ADMIN]),
    validate(createProductSchema),
    catalogController.handleCreateProduct
)

catalogRoutes.put(
    "/products/:id",
    authenticate,
    authorize([Role.ADMIN]),
    validate(updateProductSchema),
    catalogController.handleUpdateProduct
)

catalogRoutes.delete(
    "/products/:id",
    authenticate,
    authorize([Role.ADMIN]),
    catalogController.handleDeleteProduct
)