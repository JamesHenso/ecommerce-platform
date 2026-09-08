import "dotenv/config";
import express from "express";
import { authRouter } from "./modules/auth/auth.routes.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";
import { errorHandler } from "./middlewares/error.middleware.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/catalog", catalogRoutes);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});