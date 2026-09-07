import jwt from "jsonwebtoken";
import { JwtPayloadUser } from "../types/express.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "fallback_secret";
const JWT_EXPIRES_IN: jwt.SignOptions["expiresIn"] =
  (process.env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]) ?? "7d";

export const signToken = (payload: JwtPayloadUser): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const verifyToken = (token: string): JwtPayloadUser => {
    return jwt.verify(token, JWT_SECRET) as JwtPayloadUser
}