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

export const catalogRouter = Router()

catalogRouter.get("/categories", catalogController.handleGetCategories)
catalogRouter.get("/products", validate(getProductQuerySchema), catalogController.handleGetProducts)
catalogRouter.get("/products/:id", catalogController.handleGetProductById)

catalogRouter.post(
    "/categories", 
    authenticate,
    authorize([Role.ADMIN]),
    validate(createCategorySchema),
    catalogController.handleCreateCategory
)

catalogRouter.post(
    "/products",
    authenticate,
    authorize([Role.ADMIN]),
    validate(createProductSchema),
    catalogController.handleCreateProduct
)

catalogRouter.put(
    "/products/:id",
    authenticate,
    authorize([Role.ADMIN]),
    validate(updateProductSchema),
    catalogController.handleUpdateProduct
)

catalogRouter.delete(
    "/products/:id",
    authenticate,
    authorize([Role.ADMIN]),
    catalogController.handleDeleteProduct
)